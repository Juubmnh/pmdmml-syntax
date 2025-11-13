import vscode from 'vscode'
import { exec, execFile } from 'child_process'
import path from 'path'
import os from 'os'

import { convertMMLNumber, MMLDefinitionProvider } from './syntax'
import { createDecorations, updateDecorations } from './decoration'

export function getEnv() {
    const config = vscode.workspace.getConfiguration('pmdmml-syntax')

    const batchPath = config.get<string>('batchPath')
    if (!batchPath) {
        vscode.window.showErrorMessage('Please set pmdmml-syntax.batchPath in settings.')
        return null
    }

    return path.dirname(batchPath)
}

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration()
	createDecorations(config)

	const instrumentProvider = new MMLDefinitionProvider()
	context.subscriptions.push(
		vscode.commands.registerCommand('pmdmml-syntax.compile', async () => {
			const config = vscode.workspace.getConfiguration('pmdmml-syntax')

			const batchPath = config.get<string>('batchPath')
			if (!batchPath) {
				vscode.window.showErrorMessage('Please set pmdmml-syntax.batchPath in settings.')
				return
			}

			const editor = vscode.window.activeTextEditor
			if (!editor) {
				vscode.window.showErrorMessage('No active file to compile.')
				return
			}

			await vscode.window.activeTextEditor?.document.save()
			exec(`"${batchPath}" "${path.basename(editor.document.uri.fsPath)}"`, execHandler)
		}),
		vscode.commands.registerCommand('pmdmml-syntax.convertNum', async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const range = editor.document.getWordRangeAtPosition(editor.selection.active, /\d+|\$[0-9A-Fa-f]+/)
			if (!range) return

			const match = editor.document.getText(range).match(/(\d+)|\$([0-9A-Fa-f]+)/)
			if (!match) return

			const result = match[1] ? `$${Number(match[1]).toString(16)}` : `${parseInt(match[2], 16)}`
			const input = await vscode.window.showInputBox({
				prompt: 'Convert number radix or get sum',
				value: result
			})
			if (!input) return

			let final = input
			if (input.includes('+')) {
				const terms = input.split('+')
				let sum = 0
				terms.forEach(str => {
					const num = convertMMLNumber(str)
					if (num) {
						sum += num
					} else {
						throw new Error()
					}
				})
				if (terms.length == 0) {
					throw new Error()
				} else {
					final = terms[0].trim()[0] === '$' ? `$${sum.toString(16)}` : `${sum}`
				}
			}

			const edit = new vscode.WorkspaceEdit()
			edit.replace(editor.document.uri, range, final)
			await vscode.workspace.applyEdit(edit)
		}),
		vscode.languages.registerDefinitionProvider(
			{ language: "pmdmml" },
			instrumentProvider
		),
		vscode.languages.registerHoverProvider(
			{ language: 'pmdmml' },
			instrumentProvider
		),
		vscode.workspace.onDidChangeConfiguration(e => {
			createDecorations(vscode.workspace.getConfiguration())
			if (vscode.window.activeTextEditor) updateDecorations(vscode.window.activeTextEditor, config)
		}),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) updateDecorations(editor, config)
		}),
		vscode.workspace.onDidChangeTextDocument(e => {
			const editor = vscode.window.activeTextEditor
			if (editor && e.document === editor.document) updateDecorations(editor, config)
		})
	)
	if (os.platform() === "win32") {
		context.subscriptions.push(
			vscode.commands.registerCommand('pmdmml-syntax.runTool', () => {
				const exePath = path.join(context.extensionPath, "bin", "TimbreTrial.exe")
				execFile(exePath, [], execHandler)
			}),
		)
	}

	if (vscode.window.activeTextEditor) updateDecorations(vscode.window.activeTextEditor, config)
}

function execHandler(error: any, stdout: string, stderr: string) {
	if (error) {
		vscode.window.showErrorMessage(error.message)
	}
	if (stdout) {
		vscode.window.showInformationMessage(stdout);
	}
	if (stderr) {
		vscode.window.showErrorMessage(stderr)
	}
}