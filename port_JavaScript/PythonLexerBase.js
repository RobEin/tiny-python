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

'use strict';

import { Token, Lexer } from "antlr4";
import PythonLexer from "./PythonLexer.js";

export default class PythonLexerBase extends Lexer {
    static #INVALID_LENGTH = -1;
    static #ERR_TXT = " ERROR: ";
    static #TAB_LENGTH = 8;

    // Indentation handling
    #indentationLengthStack;
    #pendingTokenQueue;

    // Last pending token types
    #previousPendingTokenType;
    #lastPendingTokenTypeFromDefaultChannel;

    // Parenthesis / bracket / brace counts
    #openParenBracketBraceCount;

    #wasSpaceIndentation;
    #wasTabIndentation;
    #hasMixedIndentationBeenReported;

    // Current / lookahead tokens
    #curToken;
    #laToken;

    constructor(input) {
        super(input);
        this.#init();
    }

    reset() {
        this.#init();
        super.reset();
    }

    #init() {
        this.#indentationLengthStack = [];
        this.#pendingTokenQueue = [];
        this.#previousPendingTokenType = 0;
        this.#lastPendingTokenTypeFromDefaultChannel = 0;
        this.#openParenBracketBraceCount = 0;
        this.#wasSpaceIndentation = false;
        this.#wasTabIndentation = false;
        this.#hasMixedIndentationBeenReported = false;
        this.#curToken = null;
        this.#laToken = null;
    }

    nextToken() { // reading the input stream until a return EOF
        this.#processCurrentToken();
        return this.#pendingTokenQueue.shift() /* .pollFirst() */; // Add the queued token to the token stream
    }

    #processCurrentToken() {
        if (this.#previousPendingTokenType === Token.EOF) return;

        this.#setCurrentAndLookAheadTokens();
        if (this.#indentationLengthStack.length === 0) { // We're at the first token
            this.#handleStartOfInput();
        }

        switch (this.#curToken.type) {
            case PythonLexer.NEWLINE:
                this.#handleNEWLINEtoken();
                break;            
            case PythonLexer.LPAR:
            case PythonLexer.LSQB:
            case PythonLexer.LBRACE:
                this.#openParenBracketBraceCount++;
                this.#addPendingToken(this.#curToken);
                break;
            case PythonLexer.RPAR:
            case PythonLexer.RSQB:
            case PythonLexer.RBRACE:
                this.#openParenBracketBraceCount--;
                this.#addPendingToken(this.#curToken);
                break;
            case PythonLexer.ERRORTOKEN:
                this.#reportLexerError(`token recognition error at: '${this.#curToken.text}'`);
                this.#addPendingToken(this.#curToken);
                break;
            case Token.EOF:
                this.#handleEOFtoken();
                break;
            default:
                this.#addPendingToken(this.#curToken);
        }
    }

    #setCurrentAndLookAheadTokens() {
        this.#curToken = this.#laToken == undefined ?
            super.nextToken() :
            this.#laToken;

        this.#laToken = this.#curToken.type === Token.EOF ?
            this.#curToken :
            super.nextToken();
    }

    // ===================== Leading‑Token Preprocessing =====================
    // - initialize indent stack with a default 0 indentation length
    // - hide leading NEWLINE(s)
    // - insert leading INDENT if first statement is indented
    #handleStartOfInput() {
        this.#indentationLengthStack.push(0); // this will never be popped off
        while (this.#curToken.type !== Token.EOF) {
            if (this.#curToken.channel === Token.DEFAULT_CHANNEL) {
                if (this.#curToken.type === PythonLexer.NEWLINE) {
                    // all the NEWLINE tokens must be ignored before the first statement
                    this.#hideAndAddPendingToken(this.#curToken);
                } else { // We're at the first statement
                    this.#insertLeadingIndentToken();
                    return; // continue the processing of the current token with #processCurrentToken()
                }
            } else {
                this.#addPendingToken(this.#curToken); // it can be WS, EXPLICIT_LINE_JOINING or COMMENT token
            }
            this.#setCurrentAndLookAheadTokens();
        } // continue the processing of the EOF token with #processCurrentToken()
    }

    #insertLeadingIndentToken() {
        if (this.#previousPendingTokenType === PythonLexer.WS) {
            let prevToken = this.#pendingTokenQueue.at(- 1) /* stack peek */;
            if (this.#getIndentationLength(prevToken.text) !== 0) { // there is an "indentation" before the first statement
                const errMsg = "first statement indented";
                this.#reportLexerError(errMsg);
                // insert an INDENT token before the first statement to trigger an 'unexpected indent' error later in the parser
                this.#createAndAddPendingToken(PythonLexer.INDENT, PythonLexerBase.#ERR_TXT + errMsg, this.#curToken);
            }
        }
    }

    // ===================== Indentation Handling =====================
    // Processes NEWLINE tokens, computes indentation length from leading
    // whitespace, manages the INDENT/DEDENT stack, emits the appropriate
    // indentation tokens, and detects inconsistent mixing of tabs and spaces

    #handleNEWLINEtoken() {
        if (this.#openParenBracketBraceCount > 0) { // We're in an implicit line joining, ignore the current NEWLINE token
            this.#hideAndAddPendingToken(this.#curToken);
            return;
        }

        let nlToken = this.#curToken.clone(); // save the current NEWLINE token
        const isLookingAhead = this.#laToken.type === PythonLexer.WS;
        if (isLookingAhead) {
            this.#setCurrentAndLookAheadTokens(); // set the next two tokens
        }

        switch (this.#laToken.type) {
            case PythonLexer.NEWLINE: // We're before a blank line
            case PythonLexer.COMMENT: // We're before a comment
                this.#hideAndAddPendingToken(nlToken);
                if (isLookingAhead) {
                    this.#addPendingToken(this.#curToken); // WS token
                }
                break;
            default:
                this.#addPendingToken(nlToken);
                if (isLookingAhead) { // We're on whitespace(s) followed by a statement
                    const indentationLength = this.#laToken.type === Token.EOF ?
                        0 :
                        this.#getIndentationLength(this.#curToken.text);

                    if (indentationLength !== PythonLexerBase.#INVALID_LENGTH) {
                        this.#addPendingToken(this.#curToken); // WS token
                        this.#insertIndentOrDedentToken(indentationLength); // may insert INDENT token or DEDENT token(s)
                    } else {
                        this.#reportError("inconsistent use of tabs and spaces in indentation");
                    }
                } else { // We're at a newline followed by a statement (there is no whitespace before the statement)
                    this.#insertIndentOrDedentToken(0); // may insert DEDENT token(s)
                }
        }
    }

    #insertIndentOrDedentToken(curIndentLength) {
        let prevIndentLength = this.#indentationLengthStack.at(-1) /* stack peek */;
        if (curIndentLength > prevIndentLength) {
            this.#createAndAddPendingToken(PythonLexer.INDENT, null, this.#laToken);
            this.#indentationLengthStack.push(curIndentLength);
        } else {
            while (curIndentLength < prevIndentLength) { // more than 1 DEDENT token may be inserted to the token stream
                this.#indentationLengthStack.pop();
                prevIndentLength = this.#indentationLengthStack.at(-1) /* stack peek */;
                if (curIndentLength <= prevIndentLength) {
                    this.#createAndAddPendingToken(PythonLexer.DEDENT, null, this.#laToken);
                } else {
                    this.#reportError("inconsistent dedent");
                }
            }
        }
    }

    #getIndentationLength(indentText) { // the indentText may contain spaces, tabs or form feeds
        let length = 0;
        for (let ch of indentText) {
            switch (ch) {
                case " ":
                    this.#wasSpaceIndentation = true;
                    length += 1;
                    break;
                case "\t":
                    this.#wasTabIndentation = true;
                    length += PythonLexerBase.#TAB_LENGTH - (length % PythonLexerBase.#TAB_LENGTH);
                    break;
                case "\f": // form feed
                    length = 0;
                    break;
            }
        }

        if (this.#wasTabIndentation && this.#wasSpaceIndentation) {
            if (!this.#hasMixedIndentationBeenReported) {
                this.#hasMixedIndentationBeenReported = true;
                length = PythonLexerBase.#INVALID_LENGTH; // only for the first inconsistent indent
            }
        }
        return length;
    }

    // ===================== Trailing‑Token Finalization =====================
    // Handles end-of-input cleanup, including emission of remaining DEDENT tokens,
    // final NEWLINE normalization, and generation of the EOF token to properly
    // terminate the logical token stream.
    
    #insertTrailingTokens() {
        switch (this.#lastPendingTokenTypeFromDefaultChannel) {
            case PythonLexer.NEWLINE:
            case PythonLexer.DEDENT:
                break; // no trailing NEWLINE token is needed
            default:
                // insert an extra trailing NEWLINE token that serves as the end of the last statement
                this.#createAndAddPendingToken(PythonLexer.NEWLINE, null, this.#laToken); // _ffgToken is EOF
        }
        this.#insertIndentOrDedentToken(0); // Now insert as much trailing DEDENT tokens as needed
    }

    #handleEOFtoken() {
        if (this.#lastPendingTokenTypeFromDefaultChannel > 0) {
            // there was a statement in the input (leading NEWLINE tokens are hidden)
            this.#insertTrailingTokens();
        }
        this.#addPendingToken(this.#curToken);
    }

    // ===================== Pending‑Token Management =====================
    // Manages the queue of pending tokens, including emission of normal and hidden
    // tokens, preserving correct output order for the token stream.

    #hideAndAddPendingToken(originalToken) {
        originalToken.channel = Token.HIDDEN_CHANNEL;
        this.#addPendingToken(originalToken);
    }

    #createAndAddPendingToken(type, text, originalToken) {
        const token = originalToken.clone();
        token.type = type;
        token.channel = Token.DEFAULT_CHANNEL;
        token.stop = originalToken.start - 1;
        token.text = text == null ?
            `<${this.getSymbolicNames()[type]}>` :
            text;

        this.#addPendingToken(token);
    }

    #addPendingToken(token) {
        // save the last pending token type because the _pendingTokens linked list can be empty by the nextToken()
        this.#previousPendingTokenType = token.type;
        if (token.channel === Token.DEFAULT_CHANNEL) {
            this.#lastPendingTokenTypeFromDefaultChannel = this.#previousPendingTokenType;
        }
        this.#pendingTokenQueue.push(token) /* .addLast(token) */;
    }

    // ===================== Error Reporting & Diagnostics =====================
    // Provides consistent lexer-level error reporting, including generation of
    // ERRORTOKEN instances, construction of human-readable diagnostic messages,
    // and insertion of error markers into the token stream to ensure that the
    // parser receives accurate context for recovery.

    #reportLexerError(errMsg) {
        this.getErrorListener().syntaxError(this, this.#curToken.type, this.#curToken.line, this.#curToken.column, " LEXER" + PythonLexerBase.#ERR_TXT + errMsg, null);
    }

    #reportError(errMsg) {
        this.#reportLexerError(errMsg);

        this.#createAndAddPendingToken(PythonLexer.ERRORTOKEN, PythonLexerBase.#ERR_TXT + errMsg, this.#laToken);
        // the ERRORTOKEN also triggers a parser error 
    }
}
