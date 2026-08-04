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

// ****  Implemented in Java 8 for compatibility with ANTLR4 Java runtime **** 

import java.util.*;

import org.antlr.v4.runtime.*;

public abstract class PythonLexerBase extends Lexer {
    private final int INVALID_LENGTH = -1;
    private final String ERR_TXT = " ERROR: ";
    private final int TAB_LENGTH = 8;

    // Indentation handling
    private Deque<Integer> indentLengthStack;
    private LinkedList<Token> pendingTokenQueue;

    // Last pending token types
    private int previousPendingTokenType;
    private int lastPendingTokenTypeFromDefaultChannel;

    // Parenthesis / bracket / brace counts
    private int openParenBracketBraceCount;

    private boolean wasSpaceIndentation;
    private boolean wasTabIndentation;
    private boolean hasMixedIndentationBeenReported;

    // Current / lookahead tokens
    private Token curToken;
    private Token laToken;

    protected PythonLexerBase(CharStream input) {
        super(input);
        this.init();
    }

    @Override
    public void reset() {
        this.init();
        super.reset();
    }

    private void init() {
        this.indentLengthStack = new ArrayDeque<>();
        this.pendingTokenQueue = new LinkedList<>();
        this.previousPendingTokenType = 0;
        this.lastPendingTokenTypeFromDefaultChannel = 0;
        this.openParenBracketBraceCount = 0;
        this.wasSpaceIndentation = false;
        this.wasTabIndentation = false;
        this.hasMixedIndentationBeenReported = false;
        this.curToken = null;
        this.laToken = null;
    }

    @Override
    public Token nextToken() { // Reading the input stream until EOF is reached
        this.processCurrentToken();
        return this.pendingTokenQueue.pollFirst(); // Add the queued token to the token stream
    }

    private void processCurrentToken() {
        if (this.previousPendingTokenType == Token.EOF) return;

        this.setCurrentAndLookAheadTokens();
        if (this.indentLengthStack.isEmpty()) { // We're at the first token
            this.handleStartOfInput();
        }

        switch (this.curToken.getType()) {
            case PythonLexer.NEWLINE:
                this.handleNEWLINEtoken();
                break;
            case PythonLexer.LPAR:
            case PythonLexer.LSQB:
            case PythonLexer.LBRACE:
                this.openParenBracketBraceCount++;
                this.addPendingToken(this.curToken);
                break;
            case PythonLexer.RPAR:
            case PythonLexer.RSQB:
            case PythonLexer.RBRACE:
                this.openParenBracketBraceCount--;
                this.addPendingToken(this.curToken);
                break;
            case PythonLexer.ERRORTOKEN:
                this.reportLexerError("token recognition error at: '" + this.curToken.getText() + "'");
                this.addPendingToken(this.curToken);
                break;
            case Token.EOF:
                this.handleEOFtoken();
                break;
            default:
                this.addPendingToken(this.curToken);
        }
    }

    private void setCurrentAndLookAheadTokens() {
        this.curToken = this.laToken == null ?
                super.nextToken() :
                this.laToken;

        this.laToken = this.curToken.getType() == Token.EOF ?
                this.curToken :
                super.nextToken();
    }

    // ===================== Leading‑Token Preprocessing =====================
    // - initialize indent stack with a default 0 indentation length
    // - hide leading NEWLINE(s)
    // - insert leading INDENT if first statement is indented
    private void handleStartOfInput() {
        this.indentLengthStack.push(0); // this will never be popped off
        while (this.curToken.getType() != Token.EOF) {
            if (this.curToken.getChannel() == Token.DEFAULT_CHANNEL) {
                if (this.curToken.getType() == PythonLexer.NEWLINE) {
                    // all the NEWLINE tokens must be ignored before the first statement
                    this.hideAndAddPendingToken(this.curToken);
                } else { // We're at the first statement
                    this.insertLeadingIndentToken();
                    return; // continue the processing of the current token with processCurrentToken()
                }
            } else {
                this.addPendingToken(this.curToken); // it can be WS, EXPLICIT_LINE_JOINING or COMMENT token
            }
            this.setCurrentAndLookAheadTokens();
        }
        // continue the processing of the EOF token with processCurrentToken()
    }

    private void insertLeadingIndentToken() {
        if (this.previousPendingTokenType == PythonLexer.WS) {
            Token prevToken = this.pendingTokenQueue.peekLast();
            if (this.getIndentationLength(prevToken.getText()) != 0) { // there is an "indentation" before the first statement
                final String errMsg = "first statement indented";
                this.reportLexerError(errMsg);
                // insert an INDENT token before the first statement to trigger an 'unexpected indent' error later in the parser
                this.createAndAddPendingToken(PythonLexer.INDENT, this.ERR_TXT + errMsg, this.curToken);
            }
        }
    }

    // ===================== Indentation Handling =====================
    // Processes NEWLINE tokens, computes indentation length from leading
    // whitespace, manages the INDENT/DEDENT stack, emits the appropriate
    // indentation tokens, and detects inconsistent mixing of tabs and spaces

    private void handleNEWLINEtoken() {
        if (this.openParenBracketBraceCount > 0) {
            // We're in an implicit line joining, ignore the current NEWLINE token
            this.hideAndAddPendingToken(this.curToken);
            return;
        }

        final Token nlToken = new CommonToken(this.curToken); // save the current NEWLINE token
        final boolean isLookingAhead = this.laToken.getType() == PythonLexer.WS;
        if (isLookingAhead) {
            this.setCurrentAndLookAheadTokens(); // set the next two tokens
        }

        switch (this.laToken.getType()) {
            case PythonLexer.NEWLINE: // We're before a blank line
            case PythonLexer.COMMENT: // We're before a comment
                this.hideAndAddPendingToken(nlToken);
                if (isLookingAhead) {
                    this.addPendingToken(this.curToken); // WS token
                }
                break;
            default:
                this.addPendingToken(nlToken);
                if (isLookingAhead) { // We're on whitespace(s) followed by a statement
                    final int indentationLength = this.laToken.getType() == Token.EOF ?
                            0 :
                            this.getIndentationLength(this.curToken.getText());

                    if (indentationLength != this.INVALID_LENGTH) {
                        this.addPendingToken(this.curToken); // WS token
                        this.insertIndentOrDedentToken(indentationLength); // may insert INDENT token or DEDENT token(s)
                    } else {
                        this.reportError("inconsistent use of tabs and spaces in indentation");
                    }
                } else { // We're at a newline followed by a statement (there is no whitespace before the statement)
                    this.insertIndentOrDedentToken(0); // may insert DEDENT token(s)
                }
        }
    }

    private void insertIndentOrDedentToken(final int indentLength) {
        int prevIndentLength = this.indentLengthStack.peek();
        if (indentLength > prevIndentLength) {
            this.createAndAddPendingToken(PythonLexer.INDENT, null, this.laToken);
            this.indentLengthStack.push(indentLength);
        } else {
            while (indentLength < prevIndentLength) { // more than 1 DEDENT token may be inserted to the token stream
                this.indentLengthStack.pop();
                prevIndentLength = this.indentLengthStack.peek();
                if (indentLength <= prevIndentLength) {
                    this.createAndAddPendingToken(PythonLexer.DEDENT, null, this.laToken);
                } else {
                    this.reportError("inconsistent dedent");
                }
            }
        }
    }

    private int getIndentationLength(final String indentText) { // the indentText may contain spaces, tabs or form feeds
        int length = 0;
        for (char ch : indentText.toCharArray()) {
            switch (ch) {
                case ' ':
                    this.wasSpaceIndentation = true;
                    length += 1;
                    break;
                case '\t':
                    this.wasTabIndentation = true;
                    length += this.TAB_LENGTH - (length % this.TAB_LENGTH);
                    break;
                case '\f': // form feed
                    length = 0;
                    break;
            }
        }

        if (this.wasTabIndentation && this.wasSpaceIndentation) {
            if (!(this.hasMixedIndentationBeenReported)) {
                this.hasMixedIndentationBeenReported = true;
                length = this.INVALID_LENGTH; // only for the first inconsistent indent
            }
        }
        return length;
    }

    // ===================== Trailing‑Token Finalization =====================
    // Handles end-of-input cleanup, including emission of remaining DEDENT tokens,
    // final NEWLINE normalization, and generation of the EOF token to properly
    // terminate the logical token stream.
    
    private void insertTrailingTokens() {
        switch (this.lastPendingTokenTypeFromDefaultChannel) {
            case PythonLexer.NEWLINE:
            case PythonLexer.DEDENT:
                break; // no trailing NEWLINE token is needed
            default:
                // insert an extra trailing NEWLINE token that serves as the end of the last statement
                this.createAndAddPendingToken(PythonLexer.NEWLINE, null, this.laToken); // laToken is EOF
        }
        this.insertIndentOrDedentToken(0); // Now insert as much trailing DEDENT tokens as needed
    }

    private void handleEOFtoken() {
        if (this.lastPendingTokenTypeFromDefaultChannel > 0) {
            // there was statement in the input (leading NEWLINE tokens are hidden)
            this.insertTrailingTokens();
        }
        this.addPendingToken(this.curToken);
    }

    // ===================== Pending‑Token Management =====================
    // Manages the queue of pending tokens, including emission of normal and hidden
    // tokens, preserving correct output order for the token stream.

    private void hideAndAddPendingToken(final Token originalToken) {
        CommonToken token = new CommonToken(originalToken);
        token.setChannel(Token.HIDDEN_CHANNEL);
        this.addPendingToken(token);
    }

    private void createAndAddPendingToken(final int ttype, final String text, Token originalToken) {
        CommonToken token = new CommonToken(originalToken);
        token.setType(ttype);
        token.setChannel(Token.DEFAULT_CHANNEL);
        token.setStopIndex(originalToken.getStartIndex() - 1);
        token.setText(text == null
                ? "<" + this.getVocabulary().getSymbolicName(ttype) + ">"
                : text);

        this.addPendingToken(token);
    }

    private void addPendingToken(final Token token) {
        // save the last pending token type because the pendingTokenQueue linked list can be empty by the nextToken()
        this.previousPendingTokenType = token.getType();
        if (token.getChannel() == Token.DEFAULT_CHANNEL) {
            this.lastPendingTokenTypeFromDefaultChannel = this.previousPendingTokenType;
        }
        this.pendingTokenQueue.addLast(token);
    }

    // ===================== Error Reporting & Diagnostics =====================
    // Provides consistent lexer-level error reporting, including generation of
    // ERRORTOKEN instances, construction of human-readable diagnostic messages,
    // and insertion of error markers into the token stream to ensure that the
    // parser receives accurate context for recovery.

    private void reportLexerError(final String errMsg) {
        this.getErrorListenerDispatch().syntaxError(this, this.curToken.getType(), this.curToken.getLine(), this.curToken.getCharPositionInLine(), " LEXER" + this.ERR_TXT + errMsg, null);
    }

    private void reportError(final String errMsg) {
        this.reportLexerError(errMsg);

        this.createAndAddPendingToken(PythonLexer.ERRORTOKEN, this.ERR_TXT + errMsg, this.laToken);
        // the ERRORTOKEN also triggers a parser error
    }
}
 