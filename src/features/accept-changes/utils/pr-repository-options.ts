import { repositoryTargetKey, type RepositoryRootContext } from '$shared/types/repository-context';

export function prRepositoryOptions(context: RepositoryRootContext | null) {
  const options = (context?.remotes ?? []).flatMap((remote) => {
    const resolution = remote.fetch[0]?.resolution;
    if (resolution?.state !== 'resolved') return [];
    const target = resolution.target;
    if (
      remote.fetch.some(
        (endpoint) =>
          endpoint.resolution.state !== 'resolved' ||
          repositoryTargetKey(endpoint.resolution.target) !== repositoryTargetKey(target),
      )
    )
      return [];
    return [{ remoteName: remote.name, target }];
  });
  return options.some((option) => option.target.provider === 'github') &&
    options.some((option) => option.target.provider === 'gitlab')
    ? options
    : [];
}
