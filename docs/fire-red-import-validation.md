# FireRed import validation

Validated on 2026-09-11 against the supplied Analogue Pocket raw save. The source file was
read directly from the mounted drive and was not copied into this repository or modified.

## Import boundary

- File size: 131,072 bytes (128 KiB)
- Detected family: Pokémon FireRed/LeafGreen, selected FireRed pilot profile
- Language: English
- PKHeX save-block checksums: valid
- Parser: `PKHeX.Core` 26.8.26 via `firered-pkhex-26.8.26-v1`
- Raw-save persistence: disabled

Generation III stores identify FireRed and LeafGreen jointly. The endpoint is explicitly a
FireRed-profile import, so the parser applies FireRed personal data after PKHeX identifies
the shared FRLG format and reports that inference as a warning.

## Parsed collection

| Location | Pokémon | Level | Moves | Entity | Legality | Stored stats |
| --- | --- | ---: | --- | --- | --- | --- |
| Party 1 | Mankey | 11 | Scratch, Leer, Low Kick, Karate Chop | Valid | Valid | Match calculated |
| Party 2 | Squirtle | 13 | Tackle, Water Gun, Bubble, Withdraw | Valid | Valid | Match calculated |
| Party 3 | Pidgey | 3 | Tackle | Valid | Valid | Match calculated |

No occupied PC-box slots were present. Trainer IDs, the full save fingerprint, and raw
Pokémon bytes are intentionally omitted from this document.

## Remaining acceptance check

The automated parser, checksums, entity legality, and stored-versus-calculated party stats
all agree. A separate visual comparison against the PKHeX desktop application is still
required before declaring the build-plan field-by-field acceptance gate closed.

## Showdown registration adapter

The first parsed Mankey snapshot is also a non-secret regression fixture for the registration
boundary. Automated tests verify that the server, rather than the browser, resolves its
fingerprint and explicitly supplies its level, moves, ability, nature, friendship, gender,
held item, IVs, and EVs to a pinned Generation III Showdown battle.

Showdown calculates `32 HP / 25 Atk / 13 Def / 17 SpA / 15 SpD / 22 Spe`, matching both the
stored FireRed party stats and PKHeX output. The battle starts at 32/32 HP, and each move
starts at Showdown's default maximum PP as required by the selected normalization policy.
