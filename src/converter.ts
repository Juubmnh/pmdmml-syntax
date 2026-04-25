import Fraction from 'fraction.js'
import { EOL } from 'os'

import { getEnv } from './extension'
import { convertMMLNumber, convertMMLToken, findVarDefinition, MMLDocument, NUMBER_OPTIONAL_REGEX, NUMBER_REGEX, raw } from './syntax'

type FractionInstance = InstanceType<typeof Fraction>

export function stringToFrac(str: string) {
    const numbers = str.replaceAll(/\s/g, '').split('/')
    if (numbers.length > 2) return null

    let n, d
    if (numbers.length === 1) {
        n = parseInt(numbers[0])
        d = 1
    } else {
        n = parseInt(numbers[0])
        d = parseInt(numbers[1])
    }

    return new Fraction(n, d)
}

export function fracToString(frac: FractionInstance) {
    return frac.d.toString() === '1' ? frac.n.toString() : `${frac.n}/${frac.d}`
}

function dotAdd(frac: FractionInstance, order: number) {
    return frac.add(frac.mul(new Fraction(-1, Math.pow(2, order)).add(1)))
}

class TuneState {
    length: FractionInstance
    unitLength: FractionInstance
    octave: number
    sharpened: string
    flattened: string

    title: string
    composer: string
    arranger: string
    zenlen: number
    octaveReversed: boolean
    loopDefault: number
    mainTranspose: number
    transpose: number

    constructor(unitLength: FractionInstance) {
        this.length = new Fraction(1, 4)
        this.unitLength = unitLength
        this.octave = 4
        this.sharpened = ''
        this.flattened = ''
        this.title = ''
        this.composer = ''
        this.arranger = ''
        this.zenlen = 96
        this.octaveReversed = false
        this.loopDefault = 0
        this.mainTranspose = 0
        this.transpose = 0
    }

    copy() {
        const newState = new TuneState(this.unitLength)
        newState.length = this.length
        newState.octave = this.octave
        newState.sharpened = this.sharpened
        newState.flattened = this.flattened
        newState.title = this.title
        newState.composer = this.composer
        newState.arranger = this.arranger
        newState.zenlen = this.zenlen
        newState.octaveReversed = this.octaveReversed
        newState.loopDefault = this.loopDefault
        newState.mainTranspose = this.mainTranspose
        newState.transpose = this.transpose
        return newState
    }
}

class Tune {
    voice: string
    line: string

    constructor(voice: string) {
        this.voice = voice
        this.line = ''
    }

    generate(document: MMLDocument, state: TuneState) {
        const env = getEnv()
        if (!env) return null

        const notes: Note[] = []

        let line = deconstructVariable(document, this.line)!
        line = deconstructLoop(line, state.loopDefault)

        let reserved = new Map<number, TuneState>()
        const matches = line.matchAll(new RegExp(raw`(?<reserved>\`__reserved(?<reservedId>\d+)__\`)|(?<goto>\`__goto(?<gotoId>\d+)__\`)`
            + raw`|(?<note>${noteRegexOf('')})`
            + raw`|(?<xnote>(?:x|&{1,2})${optionalLengthRegexOf('x')})`
            + raw`|(?<porta>{[^a-gx]*${noteRegexOf('ptn1')}[^a-gx]*${noteRegexOf('ptn2')}[^a-gx]*}${optionalLengthRegexOf('ptl1')}(?:,${lengthRegexOf('ptl2')})?)`
            + raw`|(?<cmdL>(?<=[\s\d])l${lengthRegexOf('l')})`
            + raw`|(?<cmdO>o(?<octave>[+-]?${NUMBER_REGEX}))`
            + raw`|(?<cmdOUp>\>)|(?<cmdODown>\<)`
            + raw`|(?<octRev>X)`
            + raw`|(?<wholeLen>C(?<newZenlen>${NUMBER_REGEX}))`
            + raw`|(?<transpose>_{(?<tpop>[=+-])(?<tpnotes>[a-g]*)})`
            + raw`|(?<modulate>_{1,2}(?<modop>[+-])(?<modparam>${NUMBER_REGEX}))`
            + raw`|(?<masterModulate>_M(?<mmodop>[+-])(?<mmodparam>${NUMBER_REGEX}))`
            + raw`|(?<cmdPrevL>(?<=l|\s|${noteRegexOf('pln')})(?:(?<plop>[=+\-^]?)${lengthRegexOf('pl')}|=?(?<plopdots>\.*)))`, 'g'))
        for (const match of matches) {
            if (!match.groups) continue
            console.log(match[0])

            if (match.groups.note) {
                notes.push(new Note(match, '', state.copy()))
            } else if (match.groups.xnote) {
                if (notes.length === 0) continue
                const lastNote = notes[notes.length - 1]

                const note = new Note((lastNote.match.groups!.name + lastNote.match.groups!.accidental
                    + match.groups.xlength + match.groups.xdots).match(noteRegexOf(''))!, '', state.copy())
                if (match[0].startsWith('&') && !match[0].startsWith('&&')) {
                    note.prefix = '-'
                }
                notes.push(note)
            } else if (match.groups.porta) {
                const note1 = new Note((match.groups.ptn1name + match.groups.ptn1accidental + match.groups.ptl1length + match.groups.ptl1dots).match(noteRegexOf(''))!, '', state.copy())
                transLength(note1, l => l.div(2))
                note1.prefix = '"Portamento"'
                notes.push(note1)

                const note2 = new Note((match.groups.ptn2name + match.groups.ptn2accidental + match.groups.ptl1length + match.groups.ptl1dots).match(noteRegexOf(''))!, '', state.copy())
                transLength(note2, l => l.div(2))
                notes.push(note2)
            } else if (match.groups.cmdL) {
                state.length = new Fraction(1, convertMMLNumber(match.groups.llength)!)
                if (match.groups.ldots) {
                    state.length = dotAdd(state.length, match.groups.ldots.length)
                }
            } else if (match.groups.cmdO) {
                if (match.groups.octave.startsWith('+')) {
                    state.octave += parseInt(match.groups.octave.substring(1))
                } else if (match.groups.octave.startsWith('-')) {
                    state.octave -= parseInt(match.groups.octave.substring(1))
                } else {
                    state.octave = parseInt(match.groups.octave)
                }
            } else if (match.groups.cmdOUp) {
                if (state.octaveReversed) {
                    state.octave--
                } else {
                    state.octave++
                }
            } else if (match.groups.cmdODown) {
                if (state.octaveReversed) {
                    state.octave++
                } else {
                    state.octave--
                }
            } else if (match.groups.octRev) {
                state.octaveReversed = !state.octaveReversed
            } else if (match.groups.wholeLen) {
                state.zenlen = parseInt(match.groups.newZenlen)
            } else if (match.groups.transpose) {
                if (match.groups.tpop === '=') {
                    for (const note of match.groups.tpnotes) {
                        if (state.sharpened.includes(note)) {
                            state.sharpened.replace(note, '')
                        }

                        if (state.flattened.includes(note)) {
                            state.flattened.replace(note, '')
                        }
                    }
                } else if (match.groups.tpop === '+') {
                    for (const note of match.groups.tpnotes) {
                        if (!state.sharpened.includes(note)) {
                            state.sharpened += note
                        }
                    }
                } else if (match.groups.tpop === '-') {
                    for (const note of match.groups.tpnotes) {
                        if (!state.flattened.includes(note)) {
                            state.flattened += note
                        }
                    }
                }
            } else if (match.groups.modulate) {
                if (match.groups.modop === '+') {
                    if (match[0].startsWith('__')) {
                        state.transpose += parseInt(match.groups.modparam)
                    } else {
                        state.transpose = parseInt(match.groups.modparam)
                    }
                } else if (match.groups.modop === '-') {
                    if (match[0].startsWith('__')) {
                        state.transpose -= parseInt(match.groups.modparam)
                    } else {
                        state.transpose = -parseInt(match.groups.modparam)
                    }
                }
            } else if (match.groups.masterModulate) {
                if (match.groups.mmodop === '+') {
                    state.transpose = parseInt(match.groups.mmodparam)
                } else if (match.groups.mmodop === '-') {
                    state.transpose = -parseInt(match.groups.mmodparam)
                }
            } else if (match.groups.cmdPrevL) {
                if (notes.length === 0) continue

                transLength(notes[notes.length - 1], l => {
                    if (!match.groups) return null
                    if (match.groups.pllength) {
                        const lengthValue = parseLength(match, 'pl', state)!
                        if (match.groups.plop === '^') {
                            l = l.mul(lengthValue)
                            if (match.groups.pldots) {
                                l = dotAdd(l, match.groups.pldots.length)
                            }
                        } else {
                            if (match.groups.plop === '+') {
                                l = l.add(lengthValue)
                            } else if (match.groups.plop === '-') {
                                l = l.sub(lengthValue)
                            } else {
                                l = lengthValue
                            }
                        }
                    } else if (match.groups.plopdots) {
                        l = dotAdd(l, match.groups.plopdots.length)
                    }

                    return l
                })
            } else if (match.groups.reserved) {
                reserved.set(parseInt(match.groups.reservedId), state.copy())
            } else if (match.groups.goto) {
                state = reserved.get(parseInt(match.groups.gotoId))!.copy()
            }
        }

        return notes
    }
}

class Note {
    match: RegExpMatchArray
    mark: string
    prefix: string
    length: FractionInstance | null
    state: TuneState

    constructor(match: RegExpMatchArray, mark: string, state: TuneState) {
        this.match = match
        this.mark = mark
        this.prefix = ""
        this.length = null
        this.state = state
    }
    
    generate() {
        if (!this.match.groups) return null
        const name = this.match.groups[`${this.mark}name`], accidental = this.match.groups[`${this.mark}accidental`]

        let result = this.prefix

        let offset = null
        if (accidental === '=') {
            if (this.state.sharpened.includes(name)) {
                offset = -1
            }
            if (this.state.flattened.includes(name)) {
                offset = 1
            }
        }
        else if (accidental === '+') {
            offset = 1
        }
        else if (accidental === '-') {
            offset = -1
        }

        if (this.state.sharpened.includes(name)) {
            if (offset) {
                offset++
            } else {
                offset = 1
            }
        }
        if (this.state.flattened.includes(name)) {
            if (offset) {
                offset--
            } else {
                offset = -1
            }
        }

        if (name === 'r') {
            result += 'z'
        } else {
            const transposed = transposeNote(this.state.mainTranspose + this.state.transpose, name, offset ?? 0, this.state.octave)
            result += transposed.accidental
            result += parseNoteName(transposed.name, transposed.octave)
        }

        const parsedLength = this.length ? this.length : parseLength(this.match, this.mark, this.state)!
        if (parsedLength.n !== parsedLength.d) {
            result += fracToString(parsedLength)
        }

        return result
    }
}

function noteRegexOf(mark: string) {
    return raw`(?<${mark}name>[a-g]|r(?![=+-]))(?<${mark}accidental>(?<!r)[=+-]?|)${optionalLengthRegexOf(mark)}`
}

const NOTE_TO_SEMITONE: Record<string, number> = {
    'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11
}

const SEMITONE_TO_SHARP_NAME: string[] = [
    'c', '^c', 'd', '^d', 'e', 'f', '^f', 'g', '^g', 'a', '^a', 'b'
]
const SEMITONE_TO_FLAT_NAME: string[] = [
    'c', '_d', 'd', '_e', 'e', 'f', '_g', 'g', '_a', 'a', '_b', 'b'
]

let sharpStyle: boolean
export function setStyle(isSharpStyle: boolean) {
    sharpStyle = isSharpStyle
}

function transposeNote(semitones: number, name: string, offset: number, octave: number) {
    const baseSemitone = NOTE_TO_SEMITONE[name]
    let absoluteSemitones = (octave * 12) + baseSemitone + offset

    absoluteSemitones += semitones

    let newOctave = Math.floor(absoluteSemitones / 12)
    let index = absoluteSemitones % 12
    if (index < 0) {
        index += 12
    }

    const resultName = sharpStyle ? SEMITONE_TO_SHARP_NAME[index] : SEMITONE_TO_FLAT_NAME[index]
    if (resultName.length > 1) {
        return {
            name: resultName[1],
            accidental: resultName[0],
            octave: newOctave
        }
    } else {
        return {
            name: resultName,
            accidental: '=',
            octave: newOctave
        }
    }
}

function parseNoteName(name: string, octave: number) {
    let result = ''

    if (octave <= 4) {
        result += name.toUpperCase().replace('R', 'z')
        if (!result.includes('z')) {
            result += ",".repeat(4 - octave)
        }
    }
    else if (octave >= 5) {
        result += name.toLowerCase().replace('r', 'z')
        if (!result.includes('z')) {
            result += "'".repeat(octave - 5)
        }
    }

    return result
}

function lengthRegexOf(mark: string) {
    return raw`(?<${mark}length>%?${NUMBER_REGEX})(?<${mark}dots>\.*)`
}
function optionalLengthRegexOf(mark: string) {
    return raw`(?<${mark}length>${NUMBER_OPTIONAL_REGEX}|%${NUMBER_REGEX})(?<${mark}dots>\.*)`
}

function parseLength(match: RegExpMatchArray, mark: string, state: TuneState) {
    if (!match.groups) return null
    const length = match.groups[`${mark}length`], dots = match.groups[`${mark}dots`]

    let parsedLength
    if (length) {
        let lengthValue
        if (length.includes('%')) {
            lengthValue = new Fraction(convertMMLNumber(length.substring(1))!, state.zenlen)
        } else {
            lengthValue = new Fraction(1, convertMMLNumber(length)!)
        }

        parsedLength = lengthValue.div(state.unitLength)
    } else {
        parsedLength = state.length.div(state.unitLength)
    }

    if (dots) {
        parsedLength = dotAdd(parsedLength, dots.length)
    }

    return parsedLength
}

function transLength(note: Note, proc: (length: FractionInstance) => FractionInstance | null) {
    const converted = note.generate()
    if (!converted) return false

    const frac = converted.match(/(\d+)\/?(\d*)/)
    let currLength: FractionInstance | null = frac ? stringToFrac(frac[0])! : new Fraction(1)

    currLength = proc(currLength)
    if (!currLength) return false

    note.length = currLength
    return true
}

function parseOverallCommands(line: string, state: TuneState) {
    const cmd = line.match(/^#(?<name>\w+)\s+(?<param>.+)/)
    if (!cmd || !cmd.groups) return

    if (cmd.groups.name === 'LoopDefault') {
        state.loopDefault = parseInt(cmd.groups.param)
    }
    if (cmd.groups.name === 'Title') {
        state.title = cmd.groups.param
    }
    if (cmd.groups.name === 'Composer') {
        state.composer = cmd.groups.param
    }
    if (cmd.groups.name === 'Arranger') {
        state.arranger = cmd.groups.param
    }
    if (cmd.groups.name === 'Zenlen') {
        state.zenlen = parseInt(cmd.groups.param)
    }
    if (cmd.groups.name === 'Octave') {
        state.octaveReversed = cmd.groups.param === 'Reverse' ? true : false
    }
    if (cmd.groups.name === 'Transpose') {
        state.mainTranspose = parseInt(cmd.groups.param)
    }
}

function deconstructVariable(document: MMLDocument, line: string) {
    const env = getEnv()
    if (!env) return null

    let result = line

    while (true) {
        const varUsage = result.match(new RegExp(raw`(?<var>(?<!\|)!(?<varName>${NUMBER_REGEX}|\S+))`))
        if (!varUsage || !varUsage.groups) break

        if (varUsage.groups.var) {
            const varDef = findVarDefinition(env, document, convertMMLToken(varUsage.groups.varName)!)
            if (varDef) {
                result = result.replaceAll(varDef.line.match(/!\S+/)![0], varDef.definition)
            } else {
                result = result.replace('!', '')
            }
        }
    }

    return result
}

let id = 0
function generateId() {
    return id++
}

function deconstructLoop(line: string, loopDefault: number) {
    let result = line

    while (true) {
        const substitution = result.match(new RegExp(raw`(?<loop>\[(?<loopContent1>[^\[:\]]*):?(?<loopContent2>[^\[:\]]*)\](?<loopTimes>${NUMBER_OPTIONAL_REGEX}))`))
        if (!substitution || !substitution.groups) break

        if (substitution.groups.loop) {
            let loopTimes = convertMMLNumber(substitution.groups.loopTimes) ?? loopDefault
            if (loopTimes === 0) loopTimes = 1

            const id = generateId()
            const recover = substitution.groups.loopContent1 + `\`__goto${id}__\`` + (substitution.groups.loopContent1 + substitution.groups.loopContent2).replaceAll(new RegExp(raw`(?<!\`__)(?:${noteRegexOf('')}|(?:x|&{1,2})${optionalLengthRegexOf('x')})(?!oto__\`)`, 'g'), '')
            if (loopTimes == 1) {
                result = result.replace(substitution[0], `\`__reserved${id}__\`` + recover)
            } else {
                result = result.replace(substitution[0], `\`__reserved${id}__\`` + (substitution.groups.loopContent1 + substitution.groups.loopContent2 + `\`__goto${id}__\``).repeat(loopTimes - 1) + recover)
            }
        }
    }

    return result
}

export function mmlToABC(document: MMLDocument, unitLength: FractionInstance) {
    const env = getEnv()
    if (!env) return null

    const initialState = new TuneState(unitLength)
    const tunes: Tune[] = []
    document.lines.forEach((line) => {
        const voices = line.match(/^([A-JL-QS-Za-z]+)\s+/)
        if (voices) {
            for (const voice of voices[1].split('')) {
                let index = tunes.findIndex((item) => {
                    return item.voice === voice
                })
                if (index === -1) {
                    tunes.push(new Tune(voice))
                    index = tunes.length - 1
                }

                tunes[index].line += line.replace(voices[0], ' `SOL` ').replaceAll(/;.*/g, '')
            }
        } else {
            parseOverallCommands(line, initialState)
        }
    })

    if (tunes.length == 0) return
    let result: string[] = [
        'X:1',
        `T:${initialState.title}`,
        `C:${initialState.arranger}`,
        `O:${initialState.composer}`,
        'M:',
        `L:${fracToString(unitLength)}`,
        'K:C'
    ]

    result.push(...tunes.map(tune => {
        tune.line = tune.line.replaceAll(/`.*?`/g, '')
        const notes = tune.generate(document, initialState)
        if (!notes) return ''
        return `[V:${tune.voice}] ${notes.map(note => note.generate()).join('')}`
    }))

    return result.join(EOL)
}
