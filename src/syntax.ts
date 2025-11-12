import vscode from 'vscode'
import path from 'path'
import fs from 'fs'

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

function resolveSSGEnvelope(id: number) {
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

function resolveSSGDrum(id: number) {
    if (id < 0 || id > 1024) return null
    const result = []
    for (let i = 0; id > 0; i++) {
        if (id & 1) result.push(SSG_DRUM_MAPPING[i])
        id >>= 1
    }
    return result.join(', ')
}

export function convertMMLNumber(str: string) {
    const match = str.match(/(?:(\d+)|\$([0-9A-Fa-f]+))/)
    if (!match) return null
    if (match[1]) return parseInt(match[1], 10)
    if (match[2]) return parseInt(match[2], 16)
    return null
}

class MMLDocument {
    uri: vscode.Uri
    lines: string[]
    pos: vscode.Position
    static cache: Map<vscode.Uri, { content: string[], mtimeMs: number }>

    constructor(uri: vscode.Uri, pos?: vscode.Position) {
        this.uri = uri

        const editor = vscode.window.activeTextEditor
        if (editor && uri === editor.document.uri) {
            this.lines = editor.document.getText().split(/\r?\n/)
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
                this.lines = text.split(/\r?\n/)
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

class DefinitionDesc {
    definition: string
    fileName: string
    location: vscode.Location
    perfectMatch: boolean

    constructor(defnition: string, fileName: string, location: vscode.Location, perfectMatch: boolean) {
        this.definition = defnition
        this.fileName = fileName
        this.location = location
        this.perfectMatch = perfectMatch
    }
}

export class MMLDefinitionProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
    onDidChangeInlayHints?: vscode.Event<void> | undefined

    get env(): string {
        const config = vscode.workspace.getConfiguration('pmdmml-syntax')

        const batchPath = config.get<string>('batchPath')
        if (!batchPath) {
            vscode.window.showErrorMessage('Please set pmdmml-syntax.batchPath in settings.')
            throw new Error('Configuration not set.')
        }

        return path.dirname(batchPath)
    }
    get isEnvSet(): boolean {
        const config = vscode.workspace.getConfiguration('pmdmml-syntax')
        return config.get<string>('batchPath') !== null
    }

    findInstrumentDefinition(document: MMLDocument, token: string, fileName: string, upper: number = 0, visited = new Set<string>())
        : DefinitionDesc | null {
        const key = document.uri.path.toUpperCase()
        if (visited.has(key)) return null
        visited.add(key)

        for (let line = document.pos.line; line >= upper; line--) {
            const text = document.lineAt(line);
            let match = text.match(new RegExp(`^@\\s*0*${token}\\s+(.+)`))
            if (match) {
                return {
                    definition: match[1],
                    fileName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
                    location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                    perfectMatch: true
                }
            }

            match = text.match(/^#(FFFile)\s+(.+)\.FFL?|^#(Include)\s+(.+)/i)
            if (match) {
                if (match[1]) {
                    const ffFile = MMLDocument.fromPath(`${this.env}\\${match[2]}.MML`)
                    let instrumentMatch, index
                    for (let i = 0; i < ffFile.lineCount; i++) {
                        instrumentMatch = ffFile.lines[i].match(new RegExp(`^@\\s*0*${token}\\s+(.+)`))
                        if (instrumentMatch) {
                            index = i
                            break
                        }
                    }
                    if (!instrumentMatch) continue

                    return {
                        definition: instrumentMatch[1],
                        fileName: match[2],
                        location: new vscode.Location(ffFile.uri, new vscode.Position(index!, 0)),
                        perfectMatch: true
                    }
                } else if (match[3]) {
                    const nextDoc = MMLDocument.fromPath(`${this.env}\\${match[4]}`)
                    const result = this.findInstrumentDefinition(nextDoc, token, match[4], 0, visited)
                    if (result) return result
                }
            }
        }

        return null
    }

    findPossibleVarDefinitions(document: MMLDocument, token: number | string, fileName: string): DefinitionDesc[];
    findPossibleVarDefinitions(document: MMLDocument, token: number | string, fileName: string, upper: number): DefinitionDesc[];
    findPossibleVarDefinitions(document: MMLDocument, token: number | string, fileName: string, upper: number, visited: Set<string>): DefinitionDesc[];

    findPossibleVarDefinitions(document: MMLDocument, token: number | string, fileName: string, upper: number = 0, visited: Set<string> = new Set())
        : DefinitionDesc[] {
        const key = document.uri.path.toUpperCase()
        if (visited.has(key)) return []
        visited.add(key)

        let array: DefinitionDesc[] = []
        for (let line = document.pos.line; line >= upper; line--) {
            const text = document.lineAt(line);
            const match = text.match(/^(?<!\|)!(?:(\d+|\$[0-9A-Fa-f]+)|(\S+))\s*(.*)/)
            if (match) {
                if (typeof token === "number") {
                    if (match[1] && token === convertMMLNumber(match[1])) {
                        return [{
                            definition: match[3],
                            fileName: fileName,
                            location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                            perfectMatch: true
                        }]
                    }
                    continue
                } else {
                    if (token === match[2]) {
                        return [{
                            definition: match[3],
                            fileName: fileName,
                            location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                            perfectMatch: true
                        }]
                    }
                    else if (token.includes(match[2])) {
                        array.push({
                            definition: match[3],
                            fileName: fileName,
                            location: new vscode.Location(document.uri, new vscode.Position(line, 0)),
                            perfectMatch: false
                        })
                    }
                }
            } else {
                const includeMatch = text.match(/^#Include\s+(.+)/i)
                if (!includeMatch) continue

                const nextDoc = MMLDocument.fromPath(`${this.env}\\${includeMatch[1]}`)
                const result = this.findPossibleVarDefinitions(nextDoc, token, includeMatch[1], 0, visited)
                if (result.length > 0) {
                    if (result[result.length - 1].perfectMatch) return result
                    else array = array.concat(result)
                }
            }
        }

        return array
    }

    findVarDefinition(document: MMLDocument, token: number | string, fileName: string) {
        const previous = this.findPossibleVarDefinitions(document, token, fileName)
        if (previous.length > 0 && previous[previous.length - 1].perfectMatch)
            return previous[previous.length - 1]

        const subsequent = this.findPossibleVarDefinitions(document, token, fileName, document.pos.line + 1)
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

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        if (!this.isEnvSet) return

        const line = document.lineAt(position.line).text
        if (line.match(/^[GHIR]/)) return

        const match = line.match(/^#(FFFile)\s+(.+)\.FFL?|^#(Include)\s+(.+)/i)
        if (match) {
            if (match[1]) {
                return new vscode.Location(vscode.Uri.file(`${this.env}\\${match[2]}.MML`), new vscode.Position(0, 0))
            } else if (match[3]) {
                return new vscode.Location(vscode.Uri.file(`${this.env}\\${match[4]}`), new vscode.Position(0, 0))
            }
        }

        let range = document.getWordRangeAtPosition(position, /(?<!^\S*)@+(?:\d+|\$[0-9A-Fa-f]+)/)
        if (range) {
            const token = document.getText(range)
            const match = token.match(/(@+)(\d+|\$[0-9A-Fa-f]+)/)!
            const identifier = (match[1].length - 1) * 128 + convertMMLNumber(match[2])!

            const mmlDoc = MMLDocument.fromTextDoc(document)
            return this.findInstrumentDefinition(mmlDoc, identifier.toString(), 'Current')?.location
        }

        range = document.getWordRangeAtPosition(position, /(?<!^\S*)(?<!\|)!(?:(?:\d+|\$[0-9A-Fa-f]+)|\S+)/)
        if (range) {
            const match = document.getText(range).match(/!(?:(\d+|\$[0-9A-Fa-f]+)|(\S+))/)!
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            return this.findVarDefinition(mmlDoc, match[1] ? convertMMLNumber(match[1])! : match[2], 'Current')?.location
        }
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Hover> {
        if (!this.isEnvSet) return

        let range = document.getWordRangeAtPosition(position, /(?<!^\S*)@+(?:\d+|\$[0-9A-Fa-f]+)/)
        if (range) {
            const token = document.getText(range)
            const match = token.match(/(@+)(\d+|\$[0-9A-Fa-f]+)/)!
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
                const result = this.findInstrumentDefinition(mmlDoc, identifier.toString(), 'Current')
                if (!result) return

                const md = new vscode.MarkdownString(`@${identifier} -> **${result.definition.trim()}** *from ${result.fileName}*`)
                md.isTrusted = true
                return new vscode.Hover(md)
            }
        }

        range = document.getWordRangeAtPosition(position, /(?<!^\S*)(?<!\|)!\S+/)
        if (range) {
            const match = document.getText(range).match(/!(?:(\d+|\$[0-9A-Fa-f]+)|(\S+))/)!
            const mmlDoc = MMLDocument.fromTextDoc(document, position)
            const result = this.findVarDefinition(mmlDoc, match[1] ? convertMMLNumber(match[1])! : match[2], 'Current')
            if (!result) return

            const md = new vscode.MarkdownString(`!${match[1] ? convertMMLNumber(match[1]) : match[2]} -> **${result.definition.trim()}** *from ${result.fileName}*`)
            md.isTrusted = true
            return new vscode.Hover(md)
        }
    }
}