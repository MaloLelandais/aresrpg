import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { get_max_health } from '../characteristics.js'
import { get_block, same_position } from '../chunk.js'
import { to_metadata } from '../entity_metadata.js'
import { PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import { block_position } from '../position.js'
import { PLAYER_ENTITY_ID } from '../settings.js'

const INTERVAL = 500

const BLOCKS = {
  fire: {
    damage: 10, // %
    fire_damage: 5, // %
    fire_loop: 5, // in interval loops
  },
  lava: {
    damage: 25,
    fire_damage: 5,
    fire_loop: 10,
  },
  sweet_berry_bush: {
    damage: 2,
  },
}

const SURFACE_BLOCKS = {
  cactus: {
    damage: 2,
  },
  magma_block: {
    damage: 5,
    fire_damage: 2,
    fire_loop: 4,
  },
}

function set_on_fire(client) {
  client.write('entity_metadata', {
    entityId: PLAYER_ENTITY_ID,
    metadata: to_metadata('entity', {
      entity_flags: {
        is_on_fire: true,
      },
    }),
  })
}

export function stop_fire(client) {
  client.write('entity_metadata', {
    entityId: PLAYER_ENTITY_ID,
    metadata: to_metadata('entity', {
      entity_flags: {
        is_on_fire: false,
      },
    }),
  })
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, dispatch, events, signal }) {
    aiter(abortable(setInterval(INTERVAL, null, { signal })))
      .map(get_state)
      .dropWhile(state => !state)
      .reduce(
        async (
          {
            last_block_position,
            took_damage,
            last_fire_damage,
            remaining_fire_loop,
          },
          { position, ...state },
        ) => {
          const current_block_position = block_position(position)

          if (
            // took_damage is just to keep inflicting damage
            // while still not calling get_block all the time if the player is not on a bad block
            took_damage ||
            !same_position(current_block_position, last_block_position)
          ) {
            const block_below = await get_block(world, {
              ...current_block_position,
              y: current_block_position.y - 1,
            })
            const block = await get_block(world, current_block_position)

            const max_health = get_max_health(state)

            const damage_from_block = BLOCKS[block.name]
            const damage_from_surface = SURFACE_BLOCKS[block_below.name]

            if (remaining_fire_loop > 0) {
              if (block.name === 'water') {
                stop_fire(client)
                return {
                  last_block_position: current_block_position,
                  last_fire_damage: 0,
                  remaining_fire_loop: -1,
                  took_damage: false,
                }
              }
              events.emit(PlayerEvent.RECEIVE_DAMAGE, {
                damage: (last_fire_damage / 100) * max_health,
              })
              // set fire_tick TICK_PER_INTERVAL * remaining_fire_loop
            } else if (remaining_fire_loop === 0) stop_fire(client)

            // if inside a dangerous block
            if (damage_from_block) {
              const {
                damage,
                fire_damage = 0,
                fire_loop = -1,
              } = damage_from_block
              events.emit(PlayerEvent.RECEIVE_DAMAGE, {
                damage: (damage / 100) * max_health,
              })

              if (fire_loop > 0) set_on_fire(client)

              return {
                last_block_position: current_block_position,
                last_fire_damage: fire_damage,
                remaining_fire_loop: fire_loop,
                took_damage: true,
              }
            }

            // if above a dangerous block
            if (damage_from_surface) {
              const {
                damage,
                fire_damage = 0,
                fire_loop = -1,
              } = damage_from_surface
              events.emit(PlayerEvent.RECEIVE_DAMAGE, {
                damage: (damage / 100) * max_health,
              })

              if (fire_loop > 0) set_on_fire(client)

              return {
                last_block_position: current_block_position,
                last_fire_damage: fire_damage,
                remaining_fire_loop: fire_loop,
                took_damage: true,
              }
            }

            return {
              last_block_position: current_block_position,
              last_fire_damage,
              remaining_fire_loop: remaining_fire_loop - 1,
              took_damage: remaining_fire_loop > 0,
            }
          }

          return {
            last_block_position: current_block_position,
            last_fire_damage,
            remaining_fire_loop: remaining_fire_loop - 1,
            took_damage: false,
          }
        },
        {
          last_block_position: null,
          took_damage: false,
          last_fire_damage: 0,
          remaining_fire_loop: -1,
        },
      )
  },
}
