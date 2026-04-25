import vscode from 'vscode'
import { exec, execFile } from 'child_process'
import Fraction from 'fraction.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { convertMMLNumber, MMLDefinitionProvider, MMLDocument } from './syntax'
import { createDecorations, updateDecorations } from './decoration'
import { fracToString, mmlToABC, setStyle, stringToFrac } from './converter'

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
	const config = vscode.workspace.getConfiguration('pmdmml-syntax')
	createDecorations(config)

	const instrumentProvider = new MMLDefinitionProvider()
	context.subscriptions.push(
		vscode.commands.registerCommand('pmdmml-syntax.compile', async () => {
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
				prompt: 'Numbers to convert or add up',
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
		vscode.commands.registerCommand('pmdmml-syntax.exportToABC', async () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const filePath = editor.document.uri.fsPath
			const defaultOutputName = path.basename(filePath, path.extname(filePath)) + '.abc'

			let outputPath: string
			if (config.get<boolean>('immediatelyConvert')) {
				outputPath = path.join(path.dirname(filePath), defaultOutputName)
			} else {
				const input = await vscode.window.showInputBox({
					prompt: 'Your ABC Notation file name',
					value: defaultOutputName
				})
				if (!input) return

				outputPath = path.join(path.dirname(filePath), input)
				if (fs.existsSync(outputPath)) {
					const overwrite = await vscode.window.showWarningMessage(`File ${input} already exists. Do you want to overwrite it?`, 'Yes', 'No')
					if (overwrite === 'No') return
				}
			}

			const sharpStyle = config.get<boolean>('abcSharpStyle')
			if (sharpStyle === undefined) return null
			setStyle(sharpStyle)

			const unitLength = config.get<string>('abcUnitNoteLength')
			if (!unitLength) return null

			const unitLengthValue = stringToFrac(unitLength)
			if (!unitLengthValue) return null

			const result = mmlToABC(MMLDocument.fromTextDoc(editor.document), unitLengthValue)
			if (!result) return

			fs.writeFile(outputPath, result, { flag: 'w' }, (err) => {
				if (err)
				{
					vscode.window.showErrorMessage(err.message)
				}
			})
		}),
		vscode.languages.registerDefinitionProvider(
			{ language: 'pmdmml' },
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
	if (os.platform() === 'win32') {
		context.subscriptions.push(
			vscode.commands.registerCommand('pmdmml-syntax.runTool', () => {
				const exePath = path.join(context.extensionPath, 'bin', 'TimbreTrial.exe')
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