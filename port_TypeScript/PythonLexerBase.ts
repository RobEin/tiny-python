/*
The MIT License (MIT)
Copyright (c) 2021 Robert Einhorn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */

/*
 *
 * Project      : A helper class for an ANTLR4 Python lexer grammar that assists in tokenizing indentation
 *
 * Developed by : Robert Einhorn, robert.einhorn.hu@gmail.com
 *
 */

import { CharStream, Token, Lexer } from "antlr4";
import PythonLexer from "./PythonLexer.js";
import * as Collections from "typescript-collections";

export default abstract class PythonLexerBase extends Lexer {
    private static readonly INVALID_LENGTH: number = -1;
    private static readonly ERR_TXT: string = " ERROR: ";
    private static readonly TAB_LENGTH: number = 8;

    // Indentation handling
    private indentationLengthStack!: Collections.Stack<number>;
    private pendingTokenQueue!: Array<Token>;

    // Last pending token types
    private previousPendingTokenType!: number;
    private lastPendingTokenTypeFromDefaultChannel!: number;

    // Parenthesis / bracket / brace counts
    private openParenBracketBraceCount!: number;

    private wasSpaceIndentation!: boolean;
    private wasTabIndentation!: boolean;
    private hasMixedIndentationBeenReported!: boolean;

    // Current / lookahead tokens
    private curToken: Token | undefined;
    private laToken:  Token | undefined;

    protected constructor(input: CharStream) {
        super(input);
        this.init();
    }

    public reset(): void {
        this.init();
        super.reset();
    }

    private init(): void {
        this.indentationLengthStack = new Collections.Stack<number>();
        this.pendingTokenQueue = [];
        this.previousPendingTokenType = 0;
        this.lastPendingTokenTypeFromDefaultChannel = 0;
        this.openParenBracketBraceCount = 0;
        this.wasSpaceIndentation = false;
        this.wasTabIndentation = false;
        this.hasMixedIndentationBeenReported = false;
        this.curToken = undefined;
        this.laToken = undefined;
    }

    public nextToken(): Token { // Reading the input stream until EOF is
        this.processCurrentToken();
        return this.pendingTokenQueue.shift()! /* .pollFirst() */; // Add the queued token to the token stream
    }

    private processCurrentToken(): void {
        if (this.previousPendingTokenType === PythonLexer.EOF) return;

        this.setCurrentAndLookAheadTokens();
        if (this.indentationLengthStack.isEmpty()) { // We're at the first token
            this.handleStartOfInput();
        }

        switch (this.curToken!.type) {
            case PythonLexer.NEWLINE:
                this.handleNEWLINEtoken();
                break;
            case PythonLexer.LPAR:
            case PythonLexer.LSQB:
            case PythonLexer.LBRACE:
                this.openParenBracketBraceCount++;
                this.addPendingToken(this.curToken!);
                break;
            case PythonLexer.RPAR:
            case PythonLexer.RSQB:
            case PythonLexer.RBRACE:
                this.openParenBracketBraceCount--;
                this.addPendingToken(this.curToken!);
                break;
            case PythonLexer.ERRORTOKEN:
                this.reportLexerError(`token recognition error at: '${this.curToken!.text}'`);
                this.addPendingToken(this.curToken!);
                break;
            case PythonLexer.EOF:
                this.handleEOFtoken();
                break;
            default:
                this.addPendingToken(this.curToken!);
        }
    }

    private setCurrentAndLookAheadTokens(): void {
        this.curToken = this.laToken == undefined
            ? super.nextToken()
            : this.laToken;

        this.laToken = this.curToken!.type === PythonLexer.EOF
            ? this.curToken
            : super.nextToken();
    }

    // ===================== Leading‑Token Preprocessing =====================
    // - initialize indent stack with a default 0 indentation length
    // - hide leading NEWLINE(s)
    // - insert leading INDENT if first statement is indented
    private handleStartOfInput(): void {
        this.indentationLengthStack.push(0); // this will never be popped off
        while (this.curToken!.type !== PythonLexer.EOF) {
            if (this.curToken!.channel === Token.DEFAULT_CHANNEL) {
                if (this.curToken!.type === PythonLexer.NEWLINE) {
                    // all the NEWLINE tokens must be ignored before the first statement
                    this.hideAndAddPendingToken(this.curToken!);
                } else { // We're at the first statement
                    this.insertLeadingIndentToken();
                    return; // continue the processing of the current token with processCurrentToken()
                }
            } else {
                this.addPendingToken(this.curToken!); // it can be WS, EXPLICIT_LINE_JOINING or COMMENT token
            }
            this.setCurrentAndLookAheadTokens();
        } // continue the processing of the EOF token with processCurrentToken()
    }

    private insertLeadingIndentToken(): void {
        if (this.previousPendingTokenType === PythonLexer.WS) {
            const prevToken: Token = this.pendingTokenQueue.at(-1)!; /* stack peek */
            if (this.getIndentationLength(prevToken!.text) !== 0) { // there is an "indentation" before the first statement
                const errMsg: string = "first statement indented";
                this.reportLexerError(errMsg);
                // insert an INDENT token before the first statement to raise an 'unexpected indent' error later by the parser
                this.createAndAddPendingToken(PythonLexer.INDENT, PythonLexerBase.ERR_TXT + errMsg, this.curToken!);
            }
        }
    }

    // ===================== Indentation Handling =====================
    // Processes NEWLINE tokens, computes indentation length from leading
    // whitespace, manages the INDENT/DEDENT stack, emits the appropriate
    // indentation tokens, and detects inconsistent mixing of tabs and spaces

    private handleNEWLINEtoken(): void {
        if (this.openParenBracketBraceCount > 0) { // We're in an implicit line joining, ignore the current NEWLINE token
            this.hideAndAddPendingToken(this.curToken!);
            return;
        }

        const nlToken: Token = this.curToken?.clone()!; // save the current NEWLINE token
        const isLookingAhead: boolean = this.laToken!.type === PythonLexer.WS;
        if (isLookingAhead) {
            this.setCurrentAndLookAheadTokens(); // set the next two tokens
        }

        switch (this.laToken!.type) {
            case PythonLexer.NEWLINE: // We're before a blank line
            case PythonLexer.COMMENT: // We're before a comment
                this.hideAndAddPendingToken(nlToken);
                if (isLookingAhead) {
                    this.addPendingToken(this.curToken!); // WS token
                }
                break;
            default:
                this.addPendingToken(nlToken);
                if (isLookingAhead) { // We're on whitespace(s) followed by a statement
                    const indentationLength: number = this.laToken!.type === PythonLexer.EOF ?
                        0 :
                        this.getIndentationLength(this.curToken!.text);

                    if (indentationLength !== PythonLexerBase.INVALID_LENGTH) {
                        this.addPendingToken(this.curToken!); // WS token
                        this.insertIndentOrDedentToken(indentationLength); // may insert INDENT token or DEDENT token(s)
                    } else {
                        this.reportError("inconsistent use of tabs and spaces in indentation");
                    }
                } else { // We're at a newline followed by a statement (there is no whitespace before the statement)
                    this.insertIndentOrDedentToken(0); // may insert DEDENT token(s)
                }
        }
    }

    private insertIndentOrDedentToken(indentLength: number): void {
        let prevIndentLength: number = this.indentationLengthStack.peek()!;
        if (indentLength > prevIndentLength) {
            this.createAndAddPendingToken(PythonLexer.INDENT, null, this.laToken!);
            this.indentationLengthStack.push(indentLength);
        } else {
            while (indentLength < prevIndentLength) { // more than 1 DEDENT token may be inserted to the token stream
                this.indentationLengthStack.pop();
                prevIndentLength = this.indentationLengthStack.peek()!;
                if (indentLength <= prevIndentLength) {
                    this.createAndAddPendingToken(PythonLexer.DEDENT, null, this.laToken!);
                } else {
                    this.reportError("inconsistent dedent");
                }
            }
        }
    }

    // ===================== Trailing‑Token Finalization =====================
    // Handles end-of-input cleanup, including emission of remaining DEDENT tokens,
    // final NEWLINE normalization, and generation of the EOF token to properly
    // terminate the logical token stream.
    
    private insertTrailingTokens(): void {
        switch (this.lastPendingTokenTypeFromDefaultChannel) {
            case PythonLexer.NEWLINE:
            case PythonLexer.DEDENT:
                break; // no trailing NEWLINE token is needed
            default:
                // insert an extra trailing NEWLINE token that serves as the end of the last statement
                this.createAndAddPendingToken(PythonLexer.NEWLINE, null, this.laToken!); // laToken is EOF
        }
        this.insertIndentOrDedentToken(0); // Now insert as much trailing DEDENT tokens as needed
    }

    private handleEOFtoken(): void {
        if (this.lastPendingTokenTypeFromDefaultChannel > 0) {
            // there was a statement in the input (leading NEWLINE tokens are hidden)
            this.insertTrailingTokens();
        }
        this.addPendingToken(this.curToken!);
    }

    // ===================== Pending‑Token Management =====================
    // Manages the queue of pending tokens, including emission of normal and hidden
    // tokens, preserving correct output order for the token stream.
    
    private hideAndAddPendingToken(originalToken: Token): void {
        originalToken.channel = Token.HIDDEN_CHANNEL;
        this.addPendingToken(originalToken);
    }

    private createAndAddPendingToken(type: number, text: string | null, originalToken: Token): void {
        const token: Token = originalToken.clone();
        token.type = type;
        token.channel = Token.DEFAULT_CHANNEL;
        token.stop = originalToken.start - 1;
        token.text = text == null ?
            `<${this.getSymbolicNames()[type]}>` :
            text;

        this.addPendingToken(token);
    }

    private addPendingToken(token: Token): void {
        // save the last pending token type because the pendingTokenQueue linked list can be empty by the nextToken()
        this.previousPendingTokenType = token.type;
        if (token.channel === Token.DEFAULT_CHANNEL) {
            this.lastPendingTokenTypeFromDefaultChannel = this.previousPendingTokenType;
        }
        this.pendingTokenQueue.push(token) /* .addLast(token) */;
    }

    private getIndentationLength(indentText: string): number { // the indentText may contain spaces, tabs or form feeds
        let length: number = 0;
        for (let ch of indentText) {
            switch (ch) {
                case " ":
                    this.wasSpaceIndentation = true;
                    length += 1;
                    break;
                case "\t":
                    this.wasTabIndentation = true;
                    length += PythonLexerBase.TAB_LENGTH - (length % PythonLexerBase.TAB_LENGTH);
                    break;
                case "\f": // form feed
                    length = 0;
                    break;
            }
        }

        if (this.wasTabIndentation && this.wasSpaceIndentation) {
            if (!this.hasMixedIndentationBeenReported) {
                this.hasMixedIndentationBeenReported = true;
                length = PythonLexerBase.INVALID_LENGTH; // only for the first inconsistent indent
            }
        }
        return length;
    }

    // ===================== Error Reporting & Diagnostics =====================
    // Provides consistent lexer-level error reporting, including generation of
    // ERRORTOKEN instances, construction of human-readable diagnostic messages,
    // and insertion of error markers into the token stream to ensure that the
    // parser receives accurate context for recovery.

    private reportLexerError(errMsg: string): void {
        this.getErrorListener().syntaxError(this, this.curToken!.type, this.curToken!.line, this.curToken!.column, " LEXER" + PythonLexerBase.ERR_TXT + errMsg, undefined);
    }

    private reportError(errMsg: string): void {
        this.reportLexerError(errMsg);

        this.createAndAddPendingToken(PythonLexer.ERRORTOKEN, PythonLexerBase.ERR_TXT + errMsg, this.laToken!);
        // the ERRORTOKEN also triggers a parser error
    }
}
