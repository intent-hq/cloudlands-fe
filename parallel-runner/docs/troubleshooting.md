# Troubleshooting Guide

## Common Issues and Solutions

### Configuration Issues

#### "Configuration file not found"
```
Error: Configuration file not found: my-config.yaml
```

**Solution:**
- Check file path is correct
- Ensure file has `.yaml` or `.yml` extension
- Use absolute path if needed

#### "No packages defined"
```
Error: No packages defined
```

**Solution:**
- Ensure `packages` array exists in config
- Check YAML indentation (use 2 spaces)
- Validate YAML syntax at yamllint.com

#### "Circular dependencies detected"
```
Error: Circular dependencies detected
```

**Solution:**
- Review package dependencies
- Remove circular references
- Use `--dry-run` to see execution plan

### Execution Issues

#### Agent Timeout
```
Error: Agent timed out after 1800000ms
```

**Solutions:**
1. Increase timeout in config:
   ```yaml
   config:
     timeoutMinutes: 60
   ```

2. Break package into smaller tasks

3. Check if agent is stuck:
   ```bash
   tail -f logs/run-*/wave1-task1-attempt1.log
   ```

#### Agent Fails Repeatedly
```
Package failed: task1
Error: Failed after 3 attempts
```

**Solutions:**
1. Check agent logs for specific errors
2. Run package individually for debugging
3. Increase retry attempts:
   ```yaml
   config:
     retryAttempts: 5
   ```

#### "Command not found: auggie"
```
Error: spawn auggie ENOENT
```

**Solutions:**
1. Install auggie CLI
2. Add auggie to PATH
3. Specify full path in code

### Monitoring Issues

#### Dashboard Shows No Data
**Solutions:**
1. Check if state file exists:
   ```bash
   ls logs/run-*/state.json
   ```

2. Verify WebSocket connection in browser console

3. Try refreshing the page

#### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3456
```

**Solutions:**
1. Use different port:
   ```bash
   ./monitor --port 8080
   ```

2. Kill process using port:
   ```bash
   lsof -i :3456
   kill -9 <PID>
   ```

### Performance Issues

#### Slow Execution
**Solutions:**
1. Increase parallel limit:
   ```yaml
   config:
     maxParallel: 8
   ```

2. Optimize package dependencies

3. Check system resources:
   ```bash
   top
   htop
   ```

#### High Memory Usage
**Solutions:**
1. Reduce parallel execution
2. Clear logs between runs
3. Monitor with `--no-monitor` flag

### Debugging Techniques

#### Enable Verbose Logging
```bash
./run my-wave.yaml --verbose
```

#### Dry Run Mode
Test configuration without executing:
```bash
./run my-wave.yaml --dry-run
```

#### Check Individual Package Logs
```bash
# View specific package log
cat logs/run-*/wave1-task1-attempt1.log

# Follow log in real-time
tail -f logs/run-*/wave1-task1-attempt1.log
```

#### Manual Agent Execution
Test a package manually:
```bash
echo "Your prompt here" | auggie -m claude-3-5-sonnet-20241022
```

### Recovery Procedures

#### Resume Failed Execution
If execution fails midway:

1. Check which packages completed:
   ```bash
   ./report --latest
   ```

2. Create new config with only failed packages

3. Run remaining packages:
   ```bash
   ./run recovery-wave.yaml
   ```

#### Clean Up Stuck Processes
```bash
# Find auggie processes
ps aux | grep auggie

# Kill stuck processes
pkill -f auggie
```

#### Reset State
```bash
# Remove all logs
rm -rf logs/

# Clear auggie sessions
rm -rf ~/.augment/sessions/
```

### Error Messages Reference

| Error | Cause | Solution |
|-------|-------|----------|
| `YAML parse error` | Invalid YAML syntax | Check indentation and syntax |
| `Package not found` | Invalid dependency | Verify package IDs |
| `Session not found` | Auggie session lost | Retry without session |
| `Rate limit exceeded` | API limit hit | Add delays or reduce parallel |
| `Out of memory` | System resources exhausted | Reduce parallel execution |

### Getting Help

1. **Check logs first**: Most issues are explained in logs
2. **Use verbose mode**: Get detailed execution information
3. **Test incrementally**: Start with simple configs
4. **Validate YAML**: Use online validators
5. **Monitor resources**: Watch system performance

### Reporting Issues

When reporting issues, include:
- Configuration file
- Error messages
- Relevant log files
- System information
- Steps to reproduce
