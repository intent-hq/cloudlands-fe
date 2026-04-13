import { describe, expect, it } from 'vitest';
import { sanitizeCommandForDisplay } from '../sanitize-credentials';

describe('sanitizeCommandForDisplay - Adversarial Tests', () => {
	// ===== REGEX BYPASS ATTEMPTS =====
	
	describe('Whitespace and formatting bypasses', () => {
		it('BYPASS: tab between flag and value', () => {
			expect(sanitizeCommandForDisplay('curl --token\tghp_secret123')).toBe(
				'curl --token ***',
			);
		});

		it('BYPASS: newline between flag and value', () => {
			expect(sanitizeCommandForDisplay('curl --token\nghp_secret123')).toBe(
				'curl --token ***',
			);
		});

		it('BYPASS: multiple spaces between flag and value', () => {
			expect(sanitizeCommandForDisplay('curl --token     ghp_secret123')).toBe(
				'curl --token ***',
			);
		});

		it('BYPASS: mixed case flag names', () => {
			expect(sanitizeCommandForDisplay('curl --Password=hunter2')).toBe(
				'curl --Password=***',
			);
		});

		it('BYPASS: mixed case in env var', () => {
			expect(sanitizeCommandForDisplay('export Api_Key=abc123')).toBe(
				'export Api_Key=***',
			);
		});
	});

	describe('Quote and escape bypasses', () => {
		it('BYPASS: escaped quotes in double-quoted value', () => {
			expect(sanitizeCommandForDisplay('export API_KEY="secret\\"with\\"quotes"')).toBe(
				'export API_KEY=***',
			);
		});

		it('BYPASS: escaped quotes in single-quoted value', () => {
			expect(sanitizeCommandForDisplay("export API_KEY='secret\\'with\\'quotes'")).toBe(
				'export API_KEY=***',
			);
		});

		it('BYPASS: mixed quotes (single inside double)', () => {
			expect(sanitizeCommandForDisplay('export API_KEY="secret\'value"')).toBe(
				'export API_KEY=***',
			);
		});

		it('BYPASS: backticks in value', () => {
			expect(sanitizeCommandForDisplay('export API_KEY=`echo secret`')).toBe(
				'export API_KEY=***',
			);
		});
	});

	describe('Special characters in values', () => {
		it('BYPASS: password with @ symbol (not in URL)', () => {
			expect(sanitizeCommandForDisplay('mysql --password=p@ssw0rd@123 -u root')).toBe(
				'mysql --password=*** -u root',
			);
		});

		it('BYPASS: password with regex metacharacters', () => {
			expect(sanitizeCommandForDisplay('export PASSWORD="p@ss.*w[0]rd+"')).toBe(
				'export PASSWORD=***',
			);
		});

		it('BYPASS: unicode characters in password', () => {
			expect(sanitizeCommandForDisplay('export API_KEY=café123🔑')).toBe(
				'export API_KEY=***',
			);
		});

		it('BYPASS: password with equals sign', () => {
			expect(sanitizeCommandForDisplay('export PASSWORD="pass=word"')).toBe(
				'export PASSWORD=***',
			);
		});
	});

	// ===== MISSED PATTERNS =====
	
	describe('Docker and container patterns', () => {
		it('MISSED: docker run -e with secret', () => {
			expect(sanitizeCommandForDisplay('docker run -e API_KEY=secret123 myapp')).toBe(
				'docker run -e API_KEY=*** myapp',
			);
		});

		it('MISSED: docker run --env with secret', () => {
			expect(sanitizeCommandForDisplay('docker run --env SECRET_TOKEN=xyz myapp')).toBe(
				'docker run --env SECRET_TOKEN=*** myapp',
			);
		});

		it('MISSED: docker-compose with inline env', () => {
			expect(sanitizeCommandForDisplay('docker-compose run -e DB_PASSWORD=hunter2 web')).toBe(
				'docker-compose run -e DB_PASSWORD=*** web',
			);
		});
	});

	describe('Kubernetes patterns', () => {
		it('MISSED: kubectl set env with secret', () => {
			expect(sanitizeCommandForDisplay('kubectl set env deployment/app API_KEY=secret123')).toBe(
				'kubectl set env deployment/app API_KEY=***',
			);
		});
	});

	describe('Cloud CLI patterns', () => {
		it('MISSED: heroku config:set', () => {
			expect(sanitizeCommandForDisplay('heroku config:set API_KEY=abc123')).toBe(
				'heroku config:set API_KEY=***',
			);
		});
	});

	describe('File operations with secrets', () => {
		it('MISSED: cat .env file with secrets', () => {
			expect(sanitizeCommandForDisplay('cat .env | grep API_KEY=secret123')).toBe(
				'cat .env | grep API_KEY=***',
			);
		});
	});

	// ===== FALSE POSITIVES =====
	
	describe('False positive checks', () => {
		it('should NOT redact file paths with "password"', () => {
			const cmd = 'cat /etc/password-policy.txt';
			expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
		});

		it('should NOT redact comments with "token"', () => {
			const cmd = '# This is a token example';
			expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
		});

		it('should NOT redact variable names without values', () => {
			const cmd = 'echo $API_KEY';
			expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
		});

		it('should NOT redact --help or --version flags', () => {
			const cmd = 'myapp --token-help --secret-version';
			expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
		});
	});

	// ===== IDEMPOTENCY =====
	
	describe('Double sanitization safety', () => {
		it('should be idempotent - sanitizing twice produces same result', () => {
			const original = 'export API_KEY=secret123';
			const once = sanitizeCommandForDisplay(original);
			const twice = sanitizeCommandForDisplay(once);
			expect(once).toBe(twice);
			expect(once).toBe('export API_KEY=***');
		});

		it('should not redact *** itself', () => {
			const cmd = 'export API_KEY=***';
			expect(sanitizeCommandForDisplay(cmd)).toBe(cmd);
		});
	});

	// ===== PERFORMANCE / CATASTROPHIC BACKTRACKING =====
	
	describe('Performance and backtracking', () => {
		it('should handle very long passwords without hanging', () => {
			const longPassword = 'a'.repeat(10000);
			const cmd = `export API_KEY=${longPassword}`;
			const result = sanitizeCommandForDisplay(cmd);

			expect(result).toBe('export API_KEY=***');
		});

		it('should handle many @ symbols without catastrophic backtracking', () => {
			const manyAts = '@'.repeat(100);
			const cmd = `curl https://user:pass${manyAts}@host.com`;
			const result = sanitizeCommandForDisplay(cmd);

			// Verify it terminates and produces output (correctness check, not timing)
			expect(typeof result).toBe('string');
		});
	});
});

