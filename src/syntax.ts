import vscode, { Location } from 'vscode'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { getEnv } from './extension'

const SSG_ENVELOPE_MAPPING = [
    'E0,0,0,0	Default',
    'E2,-1,0,1	Synth type 1',
    'E2,-2,0,1	Synth type 2',
    'E2,-2,0,8	Synth type 3',
    'E2,-1,24,1	Piano type 1',
    'E2,-2,24,1	Piano type 2',
    'E2,-2,4,1	Glockenspiel/Marimba type',
    'E2,1,0,1	Strings Type',
    'E1,2,0,1	Brass type 1',
    'E1,2,24,1	Brass type 2'
]

export function resolveSSGEnvelope(id: number) {
    if (id < 0 || id > 9) return null
    return SSG_ENVELOPE_MAPPING[id]
}

const SSG_DRUM_MAPPING = [
    'Bass Drum',
    'Snare Drum 1',
    'Low Tom',
    'Middle Tom',
    'High Tom',
    'Rim Shot',
    'Snare Drum 2',
    'Hi-Hat Close',
    'Hi-Hat Open',
    'Crash Cymbal',
    'Ride Cymbal'
]

export function resolveSSGDrum(id: number) {
    if (id < 0 || id > 1024) return null
    const result = []
    for (let i = 0; id > 0; i++) {
        if (id & 1) result.push(SSG_DRUM_MAPPING[i])
        id >>= 1
    }
    return result.join(', ')
}

export const NUMBER_REGEX = /\d+|\$[0-9A-Fa-f]+/.source
export const NUMBER_OPTIONAL_REGEX = /\d*|\$[0-9A-Fa-f]*/.source

export function convertMMLNumber(str: string) {
    const match = str.match(/(?:(\d+)|\$([0-9A-Fa-f]+))/)
    if (!match) return null
    if (match[1]) return parseInt(match[1], 10)
    if (match[2]) return parseInt(match[2], 16)
    return null
}

export const raw = String.raw
export const TOKEN_REGEX = raw`${NUMBER_REGEX}|\S+`

export function convertMMLToken(str: string) {
    const match = str.match(new RegExp(raw`(${NUMBER_REGEX})|(\S+)`))!
    if (match[1]) return convertMMLNumber(match[1])!
    if (match[2]) return match[2]
    return null
}

const IMPORT_REGEX = /^#(FFFile)\s+(.+)\.FFL?|^#(Include)\s+(.+)/i
const VAR_DEF_REGEX = raw`^(?<!\|)!(${TOKEN_REGEX})\s*(.*)`
const INCLUDE_REGEX = /^#Include\s+(.+)/i
const RHYTHM_DEF_REGEX = new RegExp(raw`^R(${NUMBER_REGEX})\s*(.*)`)

const IN_LINE_REGEX = /(?<!^\S*)/
const INSTRU_USAGE_REGEX = new RegExp(raw`(@+)(${NUMBER_REGEX})`)
const RHYTHM_USAGE_REGEX = new RegExp(raw`R(${NUMBER_REGEX})`)
const VAR_USAGE_REGEX = new RegExp(raw`(?<!\|)!(${TOKEN_REGEX})`)

export class MMLDocument {
    uri: vscode.Uri
    lines: string[]
    pos: vscode.Position
    static cache: Map<vscode.Uri, { content: string[], mtimeMs: number }>

    constructor(uri: vscode.Uri, pos?: vscode.Position) {
        this.uri = uri

        const editor = vscode.window.activeTextEditor
        if (editor && uri === editor.document.uri) {
            this.lines = editor.document.getText().split(os.EOL)
        } else {
            if (!MMLDocument.cache) MMLDocument.cache = new Map()

            let reload, cached, mtimeMs
            cached = MMLDocument.cache.get(uri)
            if (!cached) reload = true
            else {
                mtimeMs = fs.statSync(uri.fsPath).mtimeMs
                reload = cached.mtimeMs != mtimeMs
            }

            if (reload) {
                const text = fs.readFileSync(uri.fsPath, 'utf8')
                this.lines = text.split(os.EOL)
                MMLDocument.cache.set(uri, { content: this.lines, mtimeMs: mtimeMs! })
            } else {
                this.lines = cached!.content
            }
        }

        this.pos = pos ?? new vscode.Position(this.lines.length - 1, 0)
    }

    lineAt(i: number) {
        return this.lines[i]
    }

    get lineCount() {
        return this.lines.length
    }

    static fromPath(filePath: string): MMLDocument {
        return new MMLDocument(vscode.Uri.file(filePath))
    }

    static fromTextDoc(textDocument: vscode.TextDocument, position?: vscode.Position): MMLDocument {
        return new MMLDocument(textDocument.uri, position)
    }
}

export class DefinitionDesc {
    line: string
    definition: string
    fileName: string
    location: vscode.Location
    perfectMatch: boolean

    constructor(line: string, defnition: string, fileName: string, location: vscode.Location, perfectMatch: boolean) {
        this.line = line
        this.definition = defnition
        this.fileName = fileName
        this.location = location
        this.perfectMatch = perfectMatch
    }
}

function instrumentDefinitionRegexOf(token: string) {
    return new RegExp(raw`^@\s*0*${token}\s+(.+)`)
}

export function findInstrumentDefinition(env: string, document: MMLDocument, token: string, upper: number = 0, visited = new Set<string>())
    : DefinitionDesc | null {
    const key = document.uri.path.toUpperCase()
    if (visited.has(key)) return null
    visited.add(key)

    for (let line = document.pos.line; line >= upper; line--) {
        const text = document.lineAt(line)
        let match = text.match(instrumentDefinitionRegexOf(token))
        if (match) {
            return {
                line: match[0],
                definition: match[1],
                fileName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
                location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                perfectMatch: true
            }
        }

        match = text.match(IMPORT_REGEX)
        if (match) {
            if (match[1]) {
                const ffFile = MMLDocument.fromPath(`${env}\\${match[2]}.MML`)
                let instrumentMatch, index
                for (let i = 0; i < ffFile.lineCount; i++) {
                    instrumentMatch = ffFile.lines[i].match(instrumentDefinitionRegexOf(token))
                    if (instrumentMatch) {
                        index = i
                        break
                    }
                }
                if (!instrumentMatch) continue

                return {
                    line: instrumentMatch[0],
                    definition: instrumentMatch[1],
                    fileName: match[2],
                    location: new vscode.Location(ffFile.uri, new vscode.Position(index!, 0)),
                    perfectMatch: true
                }
            } else if (match[3]) {
                const nextDoc = MMLDocument.fromPath(`${env}\\${match[4]}`)
                const result = findInstrumentDefinition(env, nextDoc, token, 0, visited)
                if (result) return result
            }
        }
    }

    return null
}

function findPossibleVarDefinitions(env: string, document: MMLDocument, token: number | string): DefinitionDesc[]
function findPossibleVarDefinitions(env: string, document: MMLDocument, token: number | string, upper: number): DefinitionDesc[]
function findPossibleVarDefinitions(env: string, document: MMLDocument, token: number | string, upper: number, visited: Set<string>): DefinitionDesc[]

function findPossibleVarDefinitions(env: string, document: MMLDocument, token: number | string, upper: number = 0, visited: Set<string> = new Set())
    : DefinitionDesc[] {
    const key = document.uri.path.toUpperCase()
    if (visited.has(key)) return []
    visited.add(key)

    let array: DefinitionDesc[] = []
    for (let line = document.pos.line; line >= upper; line--) {
        const text = document.lineAt(line)
        const match = text.match(VAR_DEF_REGEX)
        if (match) {
            const matchedToken = convertMMLToken(match[1])
            if (token === matchedToken) {
                return [{
                    line: match[0],
                    definition: match[2],
                    fileName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
                    location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                    perfectMatch: true
                }]
            }
            else if (typeof token === 'string' && typeof matchedToken === 'string'
                && token.length >= matchedToken.length && token.startsWith(matchedToken)) {
                array.push({
                    line: match[0],
                    definition: match[2],
                    fileName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
                    location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                    perfectMatch: false
                })
            }
        } else {
            const includeMatch = text.match(INCLUDE_REGEX)
            if (!includeMatch) continue

            const nextDoc = MMLDocument.fromPath(`${env}\\${includeMatch[1]}`)
            const result = findPossibleVarDefinitions(env, nextDoc, token, 0, visited)
            if (result.length > 0) {
                if (result[result.length - 1].perfectMatch) return result
                else array = array.concat(result)
            }
        }
    }

    return array
}

export function findVarDefinition(env: string, document: MMLDocument, token: number | string) {
    const previous = findPossibleVarDefinitions(env, document, token)
    if (previous.length > 0 && previous[previous.length - 1].perfectMatch)
        return previous[previous.length - 1]

    const currLine = document.pos.line
    document.pos = new vscode.Position(document.lines.length - 1, 0)
    const subsequent = findPossibleVarDefinitions(env, document, token, currLine + 1)
    if (subsequent.length > 0 && subsequent[subsequent.length - 1].perfectMatch)
        return subsequent[subsequent.length - 1]

    const union = previous.concat(subsequent)
    if (union.length === 0) return null

    let maxSimilars: DefinitionDesc[] = [union[0]]
    union.forEach(desc => {
        if (desc.definition.length === maxSimilars[0].definition.length) {
            maxSimilars.push(desc)
        } else if (desc.definition.length > maxSimilars[0].definition.length) {
            maxSimilars = []
            maxSimilars.push(desc)
        }
    })
    if (maxSimilars.length === 0) return null
    return maxSimilars[0]
}

function findPossibleRhythmDefinitions(env: string, document: MMLDocument, token: number): DefinitionDesc[]
function findPossibleRhythmDefinitions(env: string, document: MMLDocument, token: number, upper: number): DefinitionDesc[]
function findPossibleRhythmDefinitions(env: string, document: MMLDocument, token: number, upper: number, visited: Set<string>): DefinitionDesc[]

function findPossibleRhythmDefinitions(env: string, document: MMLDocument, token: number, upper: number = 0, visited: Set<string> = new Set())
    : DefinitionDesc[] {
    const key = document.uri.path.toUpperCase()
    if (visited.has(key)) return []
    visited.add(key)

    let array: DefinitionDesc[] = []
    for (let line = document.pos.line; line >= upper; line--) {
        const text = document.lineAt(line)
        const match = text.match(RHYTHM_DEF_REGEX)
        if (match) {
            if (match[1] && token === convertMMLNumber(match[1])) {
                return [{
                    line: match[0],
                    definition: match[2],
                    fileName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
                    location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                    perfectMatch: true
                }]
            }
            continue
        } else {
            const includeMatch = text.match(INCLUDE_REGEX)
            if (!includeMatch) continue

            const nextDoc = MMLDocument.fromPath(`${env}\\${includeMatch[1]}`)
            const result = findPossibleRhythmDefinitions(env, nextDoc, token, 0, visited)
            if (result.length > 0) {
                if (result[result.length - 1].perfectMatch) return result
                else array = array.concat(result)
            }
        }
    }

    return array
}

export function findRhythmDefinition(env: string, document: MMLDocument, token: number) {
    const previous = findPossibleRhythmDefinitions(env, document, token)
    if (previous.length > 0 && previous[previous.length - 1].perfectMatch)
        return previous[previous.length - 1]

    const currLine = document.pos.line
    document.pos = new vscode.Position(document.lines.length - 1, 0)
    const subsequent = findPossibleRhythmDefinitions(env, document, token, currLine + 1)
    if (subsequent.length > 0 && subsequent[subsequent.length - 1].perfectMatch)
        return subsequent[subsequent.length - 1]

    const union = previous.concat(subsequent)
    if (union.length === 0) return null

    let maxSimilars: DefinitionDesc[] = [union[0]]
    union.forEach(desc => {
        if (desc.definition.length === maxSimilars[0].definition.length) {
            maxSimilars.push(desc)
        } else if (desc.definition.length > maxSimilars[0].definition.length) {
            maxSimilars = []
            maxSimilars.push(desc)
        }
    })
    if (maxSimilars.length === 0) return null
    return maxSimilars[0]
}

export class MMLDefinitionProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
    onDidChangeInlayHints?: vscode.Event<void> | undefined

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        const env = getEnv()
        if (!env) return

        const line = document.lineAt(position.line).text
        if (line.match(/^[GHIR]/)) return

        const match = line.match(IMPORT_REGEX)
        if (match) {
            if (match[1]) {
                return new vscode.Location(vscode.Uri.file(`${env}\\${match[2]}.MML`), new vscode.Position(0, 0))
            } else if (match[3]) {
                return new vscode.Location(vscode.Uri.file(`${env}\\${match[4]}`), new vscode.Position(0, 0))
            }
        }

        let range = document.getWordRangeAtPosition(position, /^@(?:\s*\d+){3}(?:\s*=.*)?$/)
        if (range) {
            return new Location(document.uri, range.start)
        }

        range = document.getWordRangeAtPosition(position, new RegExp(raw`^(?<!\|)!(?:${TOKEN_REGEX})`))
        if (range) {
            return new Location(document.uri, range.start)
        }

        range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + INSTRU_USAGE_REGEX.source))
        if (range) {
            const token = document.getText(range)
            const match = token.match(INSTRU_USAGE_REGEX)!
            const identifier = (match[1].length - 1) * 128 + convertMMLNumber(match[2])!

            const mmlDoc = MMLDocument.fromTextDoc(document)
            return findInstrumentDefinition(env, mmlDoc, identifier.toString())?.location
        }

        range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + RHYTHM_USAGE_REGEX.source))
        if (range) {
            const text = document.getText(range)
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            return findRhythmDefinition(env, mmlDoc, convertMMLNumber(text.substring(1))!)?.location
        }

        range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + VAR_USAGE_REGEX.source))
        if (range) {
            const match = document.getText(range).match(VAR_USAGE_REGEX)!
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            return findVarDefinition(env, mmlDoc, convertMMLToken(match[1])!)?.location
        }
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Hover> {
        const env = getEnv()
        if (!env) return

        let range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + INSTRU_USAGE_REGEX.source))
        if (range) {
            const token = document.getText(range)
            const match = token.match(INSTRU_USAGE_REGEX)!
            const identifier = (match[1].length - 1) * 128 + convertMMLNumber(match[2])!

            const line = document.lineAt(position.line).text
            if (line.match(/^[GHI]/)) {
                const instrumentName = resolveSSGEnvelope(identifier)
                if (!instrumentName) return

                const md = new vscode.MarkdownString(`@${identifier} -> **${instrumentName}** *from SSG Software Envelope*`)
                md.isTrusted = true
                return new vscode.Hover(md)
            } else if (line.match(/^R/)) {
                const instrumentName = resolveSSGDrum(identifier)
                if (!instrumentName) return

                const md = new vscode.MarkdownString(`@${identifier} -> **${instrumentName}** *from SSG Rhythm Definition*`)
                md.isTrusted = true
                return new vscode.Hover(md)
            } else {
                const mmlDoc = MMLDocument.fromTextDoc(document)
                const result = findInstrumentDefinition(env, mmlDoc, identifier.toString())
                if (!result) return

                const md = new vscode.MarkdownString(`@${identifier} -> **${result.definition.trim()}** *from ${result.fileName}*`)
                md.isTrusted = true
                return new vscode.Hover(md)
            }
        }

        range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + RHYTHM_USAGE_REGEX.source))
        if (range) {
            const text = document.getText(range).substring(1)
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            const result = findRhythmDefinition(env, mmlDoc, convertMMLNumber(text)!)
            if (!result) return

            const md = new vscode.MarkdownString(`R${convertMMLNumber(text)} -> **${result.definition.trim()}** *from ${result.fileName}*`)
            md.isTrusted = true
            return new vscode.Hover(md)
        }

        range = document.getWordRangeAtPosition(position, new RegExp(IN_LINE_REGEX.source + VAR_USAGE_REGEX.source))
        if (range) {
            const match = document.getText(range).match(VAR_USAGE_REGEX)!
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            const token = convertMMLToken(match[1])
            const result = findVarDefinition(env, mmlDoc, token!)
            if (!result) return

            const md = new vscode.MarkdownString(`!${typeof token === 'number' ? token : result.line.match(/(?<=!)\S+/)} -> **${result.definition.trim()}** *from ${result.fileName}*`)
            md.isTrusted = true
            return new vscode.Hover(md)
        }
    }
}