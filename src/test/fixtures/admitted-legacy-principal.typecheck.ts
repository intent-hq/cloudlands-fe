import { createAdmittedLegacyPrincipal } from './admitted-legacy-principal';

// Compiled by the existing renderer tsc gate; *.test.ts is excluded there.
function typecheckAdmittedLegacyPrincipal(): void {
  const admitted = createAdmittedLegacyPrincipal(
    {
      connections: { windowBackendId: 'remote-host' },
      daemonHealth: { connectionGeneration: 7 },
      workspaceEvents: { subscriptionGeneration: 4 },
    },
    'guest',
  );

  // @ts-expect-error the constructor owns the reducer-produced principal
  void createAdmittedLegacyPrincipal({ principal: admitted.principal });
  // @ts-expect-error serialized context is derived from the supplied slices
  void createAdmittedLegacyPrincipal({ context: 'serialized-context' });
  // @ts-expect-error list admission is set by the constructor
  void createAdmittedLegacyPrincipal({ connections: { hasReceivedList: true } });
  // @ts-expect-error health admission is set by the constructor
  void createAdmittedLegacyPrincipal({ daemonHealth: { health: 'healthy' } });
  // @ts-expect-error subscription admission is set by the constructor
  void createAdmittedLegacyPrincipal({ workspaceEvents: { subscriptionPending: false } });
}

void typecheckAdmittedLegacyPrincipal;
