import type { DemoBattleChoice, DemoBattleView } from '@pmb/domain'
import { DemoBattleManager, showdownEngineVersion, type RegisteredBattleTeam } from './DemoBattleManager.js'
import { ProductError } from '../product/LocalProductService.js'
import type { DurableProductService, MatchBattleSetup } from '../product/DurableProductService.js'

export class MatchBattleCoordinator {
  private readonly managers = new Map<string, Promise<DemoBattleManager>>()

  constructor(private readonly product: DurableProductService) {}

  async getView(userId: string, battleId: string): Promise<DemoBattleView> {
    const setup = await this.product.getMatchBattleSetup(userId, battleId)
    const manager = await this.manager(setup)
    const view = await manager.getView(setup.player)
    await this.syncOutcome(setup, manager)
    return view
  }

  async submit(userId: string, battleId: string, choice: DemoBattleChoice): Promise<DemoBattleView> {
    const setup = await this.product.getMatchBattleSetup(userId, battleId)
    if (setup.status !== 'active') throw new ProductError('This battle is complete.', 409)
    const manager = await this.manager(setup)
    const view = await manager.submit(
      setup.player,
      choice,
      () => this.product.journalBattleChoice(userId, battleId, setup.player, choice),
    )
    await this.syncOutcome(setup, manager)
    return view
  }

  async close() {
    const managers = await Promise.all(this.managers.values())
    managers.forEach((manager) => manager.close())
    this.managers.clear()
  }

  private manager(setup: MatchBattleSetup): Promise<DemoBattleManager> {
    const existing = this.managers.get(setup.battleId)
    if (existing) return existing
    const creating = this.createManager(setup).catch((error) => {
      this.managers.delete(setup.battleId)
      throw error
    })
    this.managers.set(setup.battleId, creating)
    return creating
  }

  private async createManager(setup: MatchBattleSetup) {
    if (setup.formatId !== 'gen3customgame') throw new ProductError('This match format is not supported.', 422)
    if (setup.engineVersion !== showdownEngineVersion) {
      throw new ProductError(`This match requires Pokémon Showdown ${setup.engineVersion}.`, 409)
    }
    const teams: Record<'p1' | 'p2', RegisteredBattleTeam> = {
      p1: {
        packedTeam: setup.playerOne.packedTeam,
        registrationId: setup.playerOne.registrationId,
        trainerName: setup.playerOne.name,
      },
      p2: {
        packedTeam: setup.playerTwo.packedTeam,
        registrationId: setup.playerTwo.registrationId,
        trainerName: setup.playerTwo.name,
      },
    }
    const manager = new DemoBattleManager({ matchId: setup.battleId, seed: setup.seed, teams })
    await manager.reset()
    for (const decision of setup.decisions) {
      await manager.submit(decision.player, decision.choice)
    }
    return manager
  }

  private async syncOutcome(setup: MatchBattleSetup, manager: DemoBattleManager) {
    const winner = manager.winnerPlayer()
    if (!winner) return
    const winnerId = winner === 'p1' ? setup.playerOne.id : setup.playerTwo.id
    await this.product.completeBattle(setup.battleId, winnerId, manager.showdownLog(), setup.engineVersion)
  }
}
