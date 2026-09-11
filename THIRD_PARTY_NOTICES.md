# Third-party notices

## PKHeX.Core

The local FireRed parser references `PKHeX.Core` version 26.8.26 from the official NuGet
package. PKHeX is distributed under GPL-3.0-or-later.

- Package: <https://www.nuget.org/packages/PKHeX.Core/26.8.26>
- Source and license: <https://github.com/kwsch/PKHeX>

The parser runs as a separate loopback-only .NET service. Distribution and deployment must
retain the applicable license and source-code obligations.

## Pokémon Showdown

This development spike uses the Pokémon Showdown simulator package on the server and loads
the official Pokémon Showdown battle client at runtime from `play.pokemonshowdown.com`.

- Client source: <https://github.com/smogon/pokemon-showdown-client>
- Simulator source: <https://github.com/smogon/pokemon-showdown>
- Sprite repository and credits: <https://github.com/smogon/sprites>

Pokémon Showdown's repository explains that the standalone battle replay/animation engine
is MIT-licensed, while the complete client has different licensing terms. The sprite
repository also contains its own credits and ownership notices. The remote-asset approach
here is suitable for validating the product direction, but it is not a production asset
distribution decision.

Before release, pin the renderer version, decide whether to self-host it, retain the
applicable notices, and review every included art and audio asset for the intended use.

Pokémon and all associated names and images are trademarks and copyright of their
respective owners. This project is not affiliated with or endorsed by Nintendo, Game
Freak, Creatures, The Pokémon Company, or Smogon.
