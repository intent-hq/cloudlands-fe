import { describe, expect, it } from 'vitest';
import { sanitizeCommandForDisplay } from '../sanitize-credentials';

describe('sanitizeCommandForDisplay', () => {
	// --- Environment variable assignments ---
	it('redacts export with sensitive env var', () => {
		expect(sanitizeCommandForDisplay('export API_KEY=abc123')).toBe('export API_KEY=***');
	});

	it('redacts quoted export values', () => {
		expect(sanitizeCommandForDisplay('export MY_SECRET="super secret"')).toBe(
			'export MY_SECRET=***',
		);
	});

	it('redacts inline env var assignment', () => {
		expect(sanitizeCommandForDisplay('DATABASE_PASSWORD=hunter2 rails s')).toBe(
			'DATABASE_PASSWORD=*** rails s',
		);
	});

	it('redacts env var with TOKEN in name', () => {
		expect(sanitizeCommandForDisplay('GITHUB_TOKEN=ghp_abc123 gh pr list')).toBe(
			'GITHUB_TOKEN=*** gh pr list',
		);
	});

	it('redacts env var with AUTH in name', () => {
		expect(sanitizeCommandForDisplay('export AUTH_CREDENTIAL=xyz')).toBe(
			'export AUTH_CREDENTIAL=***',
		);
	});

	it('redacts env var with PWD in name', () => {
		expect(sanitizeCommandForDisplay('DB_PWD=pass123 psql')).toBe('DB_PWD=*** psql');
	});

	// --- Authorization headers ---
	it('redacts Bearer auth header', () => {
		expect(
			sanitizeCommandForDisplay('curl -H "Authorization: Bearer eyJhb" https://api.example.com'),
		).toBe('curl -H "Authorization: ***" https://api.example.com');
	});

	it('redacts Basic auth header', () => {
		expect(
			sanitizeCommandForDisplay("curl -H 'Authorization: Basic dXNlcg==' https://example.com"),
		).toBe("curl -H 'Authorization: ***' https://example.com");
	});

	// --- Basic auth in URLs ---
	it('redacts password in https URL', () => {
		expect(sanitizeCommandForDisplay('curl https://user:secretpass@api.example.com/data')).toBe(
			'curl https://user:***@api.example.com/data',
		);
	});

	it('redacts password in connection string', () => {
		expect(
			sanitizeCommandForDisplay('psql postgresql://admin:secret@db.example.com:5432/mydb'),
		).toBe('psql postgresql://admin:***@db.example.com:5432/mydb');
	});

	it('redacts password in mongodb connection string', () => {
		expect(
			sanitizeCommandForDisplay('mongosh mongodb://root:secret@localhost:27017/admin'),
		).toBe('mongosh mongodb://root:***@localhost:27017/admin');
	});

	it('redacts password in mongodb+srv connection string', () => {
		expect(
			sanitizeCommandForDisplay('mongosh mongodb+srv://user:pass@cluster.mongodb.net'),
		).toBe('mongosh mongodb+srv://user:***@cluster.mongodb.net');
	});

	it('redacts password in git+ssh URL', () => {
		expect(
			sanitizeCommandForDisplay('git clone git+ssh://user:pass@github.com/repo.git'),
		).toBe('git clone git+ssh://user:***@github.com/repo.git');
	});

	it('redacts password in URL with email query param (greedy @ fix)', () => {
		expect(
			sanitizeCommandForDisplay('curl https://user:pass@host.com/path?email=a@b.com'),
		).toBe('curl https://user:***@host.com/path?email=a@b.com');
	});

	// --- curl -u / --user ---
	it('redacts curl -u user:pass', () => {
		expect(
			sanitizeCommandForDisplay('curl -u admin:secret123 https://api.example.com'),
		).toBe('curl -u admin:*** https://api.example.com');
	});

	it('redacts curl --user user:pass', () => {
		expect(
			sanitizeCommandForDisplay('curl --user admin:secret123 https://api.example.com'),
		).toBe('curl --user admin:*** https://api.example.com');
	});

	it('redacts curl --user=user:pass', () => {
		expect(
			sanitizeCommandForDisplay('curl --user=admin:secret123 https://api.example.com'),
		).toBe('curl --user=admin:*** https://api.example.com');
	});

	it('does NOT redact curl -u with username only (no password)', () => {
		const cmd = 'curl -u admin https://api.example.com';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	// --- CLI flags ---
	it('redacts --password=value', () => {
		expect(sanitizeCommandForDisplay('mysql --password=hunter2 -u root')).toBe(
			'mysql --password=*** -u root',
		);
	});

	it('redacts --token value', () => {
		expect(sanitizeCommandForDisplay('gh auth login --token ghp_abcdef123')).toBe(
			'gh auth login --token ***',
		);
	});

	it('redacts --secret=value', () => {
		expect(sanitizeCommandForDisplay('vault write --secret=mysecretval')).toBe(
			'vault write --secret=***',
		);
	});

	// --- Short flags for known tools ---
	it('redacts mysql -p password', () => {
		expect(sanitizeCommandForDisplay('mysql -u root -p mypassword mydb')).toBe(
			'mysql -u root -p *** mydb',
		);
	});

	it('redacts mysql -pPASSWORD (no space)', () => {
		expect(sanitizeCommandForDisplay('mysql -u root -pMyPassword mydb')).toBe(
			'mysql -u root -p*** mydb',
		);
	});

	it('does NOT treat ssh -p as password flag', () => {
		const cmd = 'ssh -p 2222 user@host.com';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	it('does NOT treat psql -p as password flag', () => {
		const cmd = 'psql -p 5433 -U admin mydb';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	// --- Non-redaction (no false positives) ---
	it('does NOT redact normal git commands', () => {
		const cmd = 'git push origin main';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	it('does NOT redact npm install', () => {
		const cmd = 'npm install express';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	it('does NOT redact ls -la', () => {
		const cmd = 'ls -la /tmp';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	it('does NOT redact normal env vars', () => {
		const cmd = 'NODE_ENV=production npm start';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	it('does NOT redact PATH assignment', () => {
		const cmd = 'export PATH=/usr/local/bin:$PATH';
		expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
	});

	// --- Edge cases ---
	it('handles empty string', () => {
		expect(sanitizeCommandForDisplay('')).toBe('');
	});

	it('handles multiple sensitive vars in one command', () => {
		expect(sanitizeCommandForDisplay('API_KEY=abc SECRET_TOKEN=xyz node app.js')).toBe(
			'API_KEY=*** SECRET_TOKEN=*** node app.js',
		);
	});

	it('redacts chained commands with &&', () => {
		expect(sanitizeCommandForDisplay('echo hi && export MY_PASSWORD=secret')).toBe(
			'echo hi && export MY_PASSWORD=***',
		);
	});
});

