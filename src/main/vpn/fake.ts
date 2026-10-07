import type { VpnEnvironment } from './manager'
import type { TunnelConfig, VpnTunnel } from './tunnel'
import { getLocalAddresses } from '../../utils/network'

/**
 * A tunnel that carries nothing: enrolment, invites and the guest's flow run for
 * real, but no interface is created and nobody is asked for a password. Used by
 * the end-to-end tests (`SCREENSHARE_FAKE_VPN=1`), which can't create network
 * interfaces. Guests then reach the room at the invite's address instead.
 */
class FakeTunnel implements VpnTunnel {
  private up_ = false

  async up(_config: TunnelConfig): Promise<{ interface: string }> {
    this.up_ = true
    return { interface: 'fake0' }
  }

  async setPeer(): Promise<void> {
    if (!this.up_) throw new Error('The VPN is not up')
  }

  async removePeer(): Promise<void> {}

  async down(): Promise<void> {
    this.up_ = false
  }
}

export function fakeVpnEnvironment(): VpnEnvironment {
  return {
    availability: async () => ({ ok: true, reason: null }),
    createTunnel: () => new FakeTunnel(),
    localAddresses: getLocalAddresses,
    roomAddress: (invite) => invite.endpoint
  }
}
