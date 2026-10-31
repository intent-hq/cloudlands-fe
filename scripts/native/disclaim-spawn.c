/*
 * macOS dev launcher: run a program as its own "responsible process".
 *
 * macOS checks privacy permissions (Screen Recording, Accessibility, Microphone)
 * against the responsible process. A dev Electron spawned from another app (a
 * terminal, an IDE, the Intent desktop app) inherits that app's responsibility,
 * so grants made to Electron.app never apply. Spawning with the responsibility
 * disclaimed makes Electron (and every helper it starts) answer for itself.
 *
 * Usage: disclaim-spawn <program> [args...]. Signals are forwarded; the exit
 * status (or terminating signal) of the program is passed through.
 */
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static volatile pid_t child = 0;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: disclaim-spawn <program> [args...]\n");
    return 64;
  }
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  int (*disclaim)(posix_spawnattr_t *, int) =
      (int (*)(posix_spawnattr_t *, int))dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
  if (disclaim) disclaim(&attr, 1);
  pid_t pid = 0;
  int rc = posix_spawn(&pid, argv[1], NULL, &attr, &argv[1], environ);
  posix_spawnattr_destroy(&attr);
  if (rc != 0) {
    fprintf(stderr, "disclaim-spawn: %s: %s\n", argv[1], strerror(rc));
    return 127;
  }
  child = pid;
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = forward;
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) return 1;
  }
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    raise(WTERMSIG(status));
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
