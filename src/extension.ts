import vscode from 'vscode'
import { exec, execFile } from 'child_process'
import path from 'path'
import os from 'os'

import { InstrumentProvider } from './syntax'
import { createDecorations, updateDecorations } from './decoration'

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration()
	createDecorations(config)

	const instrumentProvider = new InstrumentProvider()
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
	if (os.platform() == "win32") {
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