export type LogicalControl =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'menu'
  | 'start'
  | 'select'

export type SkinRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SkinControl = {
  readonly action: LogicalControl
  readonly label: string
  readonly rect: SkinRect
}

export type SkinManifest = {
  readonly id: string
  readonly name: string
  readonly author: string
  readonly source: {
    readonly kind: 'fixture' | 'deltaskin'
    readonly credit: string
  }
  readonly mappingSize: { readonly width: number; readonly height: number }
  readonly screen: SkinRect
  readonly controls: readonly SkinControl[]
}

export type DeltaSkinItem = {
  readonly inputs: readonly string[] | Readonly<Record<string, string>>
  readonly frame: SkinRect
}

export type DeltaPortraitLayout = {
  readonly assets: Readonly<Record<string, string>>
  readonly items: readonly DeltaSkinItem[]
  readonly mappingSize: { readonly width: number; readonly height: number }
  readonly screens?: readonly { readonly outputFrame: SkinRect }[]
  readonly gameScreenFrame?: SkinRect
}

export type DeltaSkinInfo = {
  readonly name: string
  readonly identifier: string
  readonly gameTypeIdentifier: string
  readonly representations: {
    readonly iphone?: {
      readonly edgeToEdge?: { readonly portrait?: DeltaPortraitLayout }
      readonly standard?: { readonly portrait?: DeltaPortraitLayout }
    }
  }
}

export type DeltaSkinImportResult = {
  readonly manifest: SkinManifest
  readonly assetPaths: readonly string[]
  readonly disabledInputs: readonly string[]
}

export const fixtureSkin = {
  id: 'labeled-purple-gba-fixture',
  name: 'Purple GBA layout fixture',
  author: 'Pocket Monster Brawl contributors',
  source: {
    kind: 'fixture',
    credit: 'Development-only geometry; not imported Delta artwork.',
  },
  mappingSize: { width: 430, height: 900 },
  screen: { x: 16, y: 96, width: 398, height: 326 },
  controls: [
    { action: 'up', label: 'Up', rect: { x: 78, y: 565, width: 62, height: 62 } },
    { action: 'down', label: 'Down', rect: { x: 78, y: 679, width: 62, height: 62 } },
    { action: 'left', label: 'Left', rect: { x: 21, y: 622, width: 62, height: 62 } },
    { action: 'right', label: 'Right', rect: { x: 135, y: 622, width: 62, height: 62 } },
    { action: 'confirm', label: 'A', rect: { x: 331, y: 570, width: 76, height: 76 } },
    { action: 'back', label: 'B', rect: { x: 256, y: 650, width: 76, height: 76 } },
    { action: 'menu', label: 'Menu', rect: { x: 29, y: 810, width: 58, height: 46 } },
    { action: 'select', label: 'Select', rect: { x: 166, y: 810, width: 66, height: 46 } },
    { action: 'start', label: 'Start', rect: { x: 260, y: 810, width: 66, height: 46 } },
  ],
} as const satisfies SkinManifest

export class InvalidSkinManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSkinManifestError'
  }
}

const externalUrl = /^(?:https?:)?\/\//i
const unsafePath = /(?:^|\/)\.\.(?:\/|$)/

export function validateSkinAssetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || unsafePath.test(normalized) || externalUrl.test(normalized)) {
    throw new InvalidSkinManifestError(`Unsafe skin asset path: ${path || '(empty)'}`)
  }
  return normalized
}

export function validateSkinManifest(manifest: SkinManifest): SkinManifest {
  const { width, height } = manifest.mappingSize
  const rectangles = [manifest.screen, ...manifest.controls.map((control) => control.rect)]

  if (width <= 0 || height <= 0) {
    throw new InvalidSkinManifestError('Skin mapping dimensions must be positive.')
  }

  for (const rect of rectangles) {
    if (
      rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
      rect.x + rect.width > width || rect.y + rect.height > height
    ) {
      throw new InvalidSkinManifestError('Skin rectangles must fit inside the mapping dimensions.')
    }
  }

  const actions = new Set(manifest.controls.map((control) => control.action))
  for (const required of ['up', 'down', 'left', 'right', 'confirm', 'back'] as const) {
    if (!actions.has(required)) {
      throw new InvalidSkinManifestError(`Skin is missing the required ${required} control.`)
    }
  }

  return manifest
}

const directInputMap: Readonly<Record<string, LogicalControl>> = {
  a: 'confirm',
  b: 'back',
  menu: 'menu',
  select: 'select',
  start: 'start',
}

function directionalControls(item: DeltaSkinItem): SkinControl[] {
  const { x, y, width, height } = item.frame
  const thirdWidth = width / 3
  const thirdHeight = height / 3
  return [
    { action: 'up', label: 'Up', rect: { x: x + thirdWidth, y, width: thirdWidth, height: thirdHeight } },
    { action: 'down', label: 'Down', rect: { x: x + thirdWidth, y: y + 2 * thirdHeight, width: thirdWidth, height: thirdHeight } },
    { action: 'left', label: 'Left', rect: { x, y: y + thirdHeight, width: thirdWidth, height: thirdHeight } },
    { action: 'right', label: 'Right', rect: { x: x + 2 * thirdWidth, y: y + thirdHeight, width: thirdWidth, height: thirdHeight } },
  ]
}

/** Adapts the documented single-screen, portrait GBA subset after archive extraction. */
export function adaptDeltaSkinInfo(info: DeltaSkinInfo, creatorCredit: string): DeltaSkinImportResult {
  if (info.gameTypeIdentifier.toLowerCase() !== 'com.rileytestut.delta.game.gba') {
    throw new InvalidSkinManifestError('Only Game Boy Advance Delta skins are supported in this milestone.')
  }

  const layout = info.representations.iphone?.edgeToEdge?.portrait
    ?? info.representations.iphone?.standard?.portrait
  if (!layout) {
    throw new InvalidSkinManifestError('The skin needs an iPhone portrait layout.')
  }

  const currentScreens = layout.screens ?? []
  if (currentScreens.length > 1) {
    throw new InvalidSkinManifestError('Multi-screen Delta skins are not supported.')
  }
  const screen = currentScreens[0]?.outputFrame ?? layout.gameScreenFrame
  if (!screen) {
    throw new InvalidSkinManifestError('The portrait layout is missing a screen output frame.')
  }

  const controls: SkinControl[] = []
  const disabledInputs = new Set<string>()

  for (const item of layout.items) {
    if (!Array.isArray(item.inputs)) {
      const inputs = item.inputs as Readonly<Record<string, string>>
      const isDirectional = ['up', 'down', 'left', 'right'].every((direction) => direction in inputs)
      if (isDirectional) controls.push(...directionalControls(item))
      else Object.values(inputs).forEach((input) => disabledInputs.add(input))
      continue
    }

    for (const input of item.inputs) {
      const action = directInputMap[input]
      if (action) controls.push({ action, label: input.toUpperCase(), rect: item.frame })
      else disabledInputs.add(input)
    }
  }

  const manifest: SkinManifest = {
    id: info.identifier,
    name: info.name,
    author: creatorCredit,
    source: { kind: 'deltaskin', credit: creatorCredit },
    mappingSize: layout.mappingSize,
    screen,
    controls,
  }

  return {
    manifest: validateSkinManifest(manifest),
    assetPaths: Object.values(layout.assets).map(validateSkinAssetPath),
    disabledInputs: [...disabledInputs].sort(),
  }
}
