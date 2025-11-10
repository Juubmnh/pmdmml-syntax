import vscode, { DefinitionProvider, Position, TextDocument } from 'vscode'
import path from 'path'
import fs from 'fs'

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

export class MMLDocument {
    uri: vscode.Uri
    lines: string[]
    pos: vscode.Position

    constructor(uri: vscode.Uri, pos?: vscode.Position) {
        this.uri = uri
        const text = fs.readFileSync(uri.fsPath, 'utf8')
        this.lines = text.split(/\r?\n/)
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

    static fromTextDoc(textDocument: TextDocument, position?: Position): MMLDocument {
        return new MMLDocument(textDocument.uri, position)
    }
}

export class InstrumentProvider implements vscode.HoverProvider, DefinitionProvider {
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

    mmlCache: Map<string, MMLDocument>
    getOrSetMMLDoc(pathAndKey: string): MMLDocument {
        let doc = this.mmlCache.get(pathAndKey)
        if (!doc) {
            doc = MMLDocument.fromPath(pathAndKey)
            this.mmlCache.set(pathAndKey, doc)
        }
        return doc
    }

    ffFileCache: Map<string, MMLDocument>
    getOrSetFFFile(nameAndKey: string): MMLDocument {
        let doc = this.ffFileCache.get(nameAndKey)
        if (!doc) {
            doc = MMLDocument.fromPath(`${this.env}\\${nameAndKey}.IDX`)
            this.ffFileCache.set(nameAndKey, doc)
        }
        return doc
    }

    constructor() {
        this.mmlCache = new Map<string, MMLDocument>
        this.ffFileCache = new Map<string, MMLDocument>
    }

    findLastFFFile(document: MMLDocument, visited = new Set<string>()): string | null {
        if (visited.has(document.uri.path)) return null
        visited.add(document.uri.path)

        for (let line = document.pos.line; line >= 0; line--) {
            const text = document.lineAt(line);
            const match = text.match(/^#(FFFile|Include)\s+(.+)\.(FFL?|MML)/i)
            if (!match) continue

            const fileType = match[1].toUpperCase()
            if (fileType == 'FFFILE') {
                return match[2]
            } else if (fileType == 'INCLUDE') {
                const nextDoc = this.getOrSetMMLDoc(`${this.env}\\${match[2]}.MML`.toUpperCase())
                const result = this.findLastFFFile(nextDoc, visited)
                if (result) return result
            }
        }

        return null
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
        if (!this.isEnvSet) return

        const textLine = document.lineAt(position.line)
        let source = /@(\d+)/g.exec(textLine.text)
        if (textLine.text.match(/^R/)) return
        if (!source) return

        const identifier = source[1]
        const mmlDoc = MMLDocument.fromTextDoc(document/*, position*/)
        const ffFileName = this.findLastFFFile(mmlDoc)
        if (!ffFileName) return

        const ffFile = this.getOrSetFFFile(ffFileName)
        let instrumentMatch, index
        for (let i = 0; i < ffFile.lineCount; i++) {
            instrumentMatch = ffFile.lines[i].match(new RegExp(`@0*${identifier}\\s+(.+)`))
            if (instrumentMatch) {
                index = i
                break
            }
        }
        if (!instrumentMatch) return

        return new vscode.Location((ffFile.uri), new vscode.Position(index!, 0))
    }

    provideHover(document: TextDocument, position: Position, _token: vscode.CancellationToken)
        : vscode.ProviderResult<vscode.Hover> {
        if (!this.isEnvSet) return

        const range = document.getWordRangeAtPosition(position, /@\d+/)

        if (!range) return

        const token = document.getText(range)
        const identifier = token.substring(1)

        const textLine = document.lineAt(position.line)
        if (textLine.text.match(/^R/)) {
            const instrumentName = resolveSSGDrum(Number(identifier))
            if (!instrumentName) return

            const md = new vscode.MarkdownString(`${token} -> **${instrumentName}** *from SSG Rhythm Definition*`)
            md.isTrusted = true
            return new vscode.Hover(md)
        } else {
            const mmlDoc = MMLDocument.fromTextDoc(document/*, position*/)
            const ffFileName = this.findLastFFFile(mmlDoc)
            if (!ffFileName) return

            const ffFile = this.getOrSetFFFile(ffFileName)
            let match
            for (const line of ffFile.lines) {
                match = line.match(new RegExp(`@0*${identifier}\\s+(.+)`))
                if (match) break
            }
            if (!match) return

            const md = new vscode.MarkdownString(`${token} -> **${match[1]}** *from ${ffFileName}*`)
            md.isTrusted = true
            return new vscode.Hover(md)
        }
    }
}