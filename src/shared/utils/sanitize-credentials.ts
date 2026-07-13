/**
 * Credential Sanitization Utility
 *
 * Detects and redacts common credential patterns from command strings
 * for safe display in the UI. Works in both renderer and main process.
 *
 * Performance: Uses pre-compiled RegExp instances for fast execution.
 */

const REDACTED = '***';

// Sensitive env var name patterns (case-insensitive)
const SENSITIVE_NAME_PATTERN =
	'(?=[A-Za-z_])[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH|PWD)[A-Za-z0-9_]*';

// 1. `export VAR=value` or `VAR=value` at start / after semicolons / after &&
//    Matches both quoted and unquoted values
const ENV_EXPORT_RE = new RegExp(
	`((?:^|(?<=\\s)|&&|;|\\|\\|)\\s*(?:export\\s+)?)(${SENSITIVE_NAME_PATTERN})(=)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\\`[^\\\`]*\\\`|\\S+)`,
	'gi',
);

// 2. Inline env var before a command: `API_KEY=val command`
//    Already covered by the pattern above since it matches VAR=value at start of string

// 3. Authorization headers: -H "Authorization: Bearer ..." or --header "Authorization: ..."
const AUTH_HEADER_RE =
	/(-[Hh]\s+|--header\s+)(['"])(Authorization:\s*)[^'"]*(\2)/gi;

// 4. Basic auth in URLs: scheme://user:pass@host
//    Uses [^\s@]+ for password so it stops at the first @ (authority boundary).
//    Passwords with literal @ in URLs should be percent-encoded as %40.
const URL_AUTH_RE = /([\w+.-]+:\/\/[^\s@]+):([^\s@]+)@(?=\S)/gi;

// 5. curl -u / --user: `curl -u user:pass` or `curl --user=user:pass`
//    Redacts only the password portion; skips if no colon (username-only is fine)
const CURL_USER_RE =
	/(curl\s+(?:\S+\s+)*(?:-u|--user)[=\s]\s*)(["']?)([^\s"':]+):([^\s"']+)\2/gi;

// 6. CLI flags with sensitive names: --password=secret, --token secret, --secret=val
const CLI_FLAG_EQ_RE =
	/(--(?:password|passwd|token|secret|api-key|api-token|auth-token|access-token|client-secret|private-key))(=)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\S+)/gi;

const CLI_FLAG_SPACE_RE =
	/(--(?:password|passwd|token|secret|api-key|api-token|auth-token|access-token|client-secret|private-key))\s+("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\S+)/gi;

// 7. Short flags for known tools: -p password (mysql, mongo, etc.)
const SHORT_FLAG_RE =
	/((?:mysql|mongosh?|redis-cli|sshpass)\s+(?:\S+\s+)*-[pP])\s+(\S+)/gi;

// 8. mysql -pPASSWORD (no space between -p and password)
const MYSQL_DASH_P_RE = /(mysql\s+(?:\S+\s+)*-[pP])(\S+)/gi;

/**
 * Sanitize a command string for safe display by redacting credentials.
 *
 * @param command - The raw command string
 * @returns The command with credential values replaced by `***`
 */
export function sanitizeCommandForDisplay(command: string): string {
	if (!command) return command;

	let result = command;

	// Apply patterns in order of specificity

	// Auth headers
	result = result.replace(AUTH_HEADER_RE, `$1$2Authorization: ${REDACTED}$4`);

	// curl -u / --user
	result = result.replace(CURL_USER_RE, `$1$2$3:${REDACTED}$2`);

	// URL auth (basic auth & connection strings)
	result = result.replace(URL_AUTH_RE, `$1:${REDACTED}@`);

	// CLI flags with = sign
	result = result.replace(CLI_FLAG_EQ_RE, `$1$2${REDACTED}`);

	// CLI flags with space
	result = result.replace(CLI_FLAG_SPACE_RE, `$1 ${REDACTED}`);

	// Short flags for known tools
	result = result.replace(SHORT_FLAG_RE, `$1 ${REDACTED}`);

	// mysql -pPASSWORD (no space)
	result = result.replace(MYSQL_DASH_P_RE, `$1${REDACTED}`);

	// Environment variable assignments (export and inline)
	result = result.replace(ENV_EXPORT_RE, `$1$2$3${REDACTED}`);

	return result;
}

