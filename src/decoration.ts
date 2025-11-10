import vscode from 'vscode'

const DECORATION_COUNT = 6
let decorations: Array<vscode.TextEditorDecorationType | null> = new Array(DECORATION_COUNT)

export function createDecorations(config: vscode.WorkspaceConfiguration) {
    for (let i = 1; i <= DECORATION_COUNT; i++) {
        const style = config.get<string>(`pmdmml-syntax.style${i}`)
        if (!style) continue

        const result = style.split('|')
        let options: Array<string> = new Array(3)
        for (let j = 0; j < result.length && j < 3; j++) {
            options[j] = result[j].trim()
        }

        if (decorations[i]) decorations[i]!.dispose()

        decorations[i] = vscode.window.createTextEditorDecorationType({
            color: options[0],
            fontStyle: options[1],
            fontWeight: options[2]
        })
    }
}

export function updateDecorations(editor: vscode.TextEditor, config: vscode.WorkspaceConfiguration) {
    const doc = editor.document
    if (doc.languageId !== 'pmdmml') return

    const text = doc.getText()

    for (let i = 1; i <= DECORATION_COUNT; i++) {
        const pattern = config.get<string>(`pmdmml-syntax.pattern${i}`)
        if (!pattern) continue
        if (!decorations[i]) continue

        const ranges: vscode.Range[] = []
        for (const match of text.matchAll(new RegExp(pattern, 'gm'))) {
            const start = doc.positionAt(match.index!)
            const end = doc.positionAt(match.index! + match[0].length)
            ranges.push(new vscode.Range(start, end))
        }

        editor.setDecorations(decorations[i]!, ranges)
    }
}