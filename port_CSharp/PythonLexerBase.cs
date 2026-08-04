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
 * Project      : A helper class for an ANTLR4 Python lexer grammar that assists in tokenizing indentation
 *
 * Developed by : Robert Einhorn
 */

using Antlr4.Runtime;


[assembly: CLSCompliant(true)]

public abstract class PythonLexerBase : Lexer
{
    private const int INVALID_LENGTH = -1;
    private const string ERR_TXT = " ERROR: ";
    private const int TAB_LENGTH = 8;

    // Indentation handling
    private Stack<int> indentationLengthStack = new();
    private LinkedList<IToken> pendingTokenQueue = new();

    // Last pending token types
    private int previousPendingTokenType;
    private int lastPendingTokenTypeFromDefaultChannel;

    // Parenthesis / bracket / brace counts
    private int openParenBracketBraceCount;

    // Indentation diagnostics
    private bool wasSpaceIndentation;
    private bool wasTabIndentation;
    private bool hasMixedIndentationBeenReported;

    // Current / lookahead tokens
    private IToken curToken = null!;
    private IToken laToken = null!;

    protected PythonLexerBase(ICharStream input)
        : this(input, Console.Out, Console.Error) { }

    protected PythonLexerBase(ICharStream input, TextWriter output, TextWriter errorOutput)
        : base(input, output, errorOutput) { }

    public override void Reset()
    {
        this.Init();
        base.Reset();
    }

    private void Init()
    {
        this.indentationLengthStack = new();
        this.pendingTokenQueue = new();
        this.previousPendingTokenType = 0;
        this.lastPendingTokenTypeFromDefaultChannel = 0;
        this.openParenBracketBraceCount = 0;
        this.wasSpaceIndentation = false;
        this.wasTabIndentation = false;
        this.hasMixedIndentationBeenReported = false;
        this.curToken = null!;
        this.laToken = null!;
    }

    public override IToken NextToken() // Reading the input stream until EOF is reached
    {
        this.ProcessCurrentToken();
        IToken firstPendingToken = this.pendingTokenQueue.First!.Value;
        this.pendingTokenQueue.RemoveFirst();
        return firstPendingToken; // Add the queued token to the token stream
    }

    private void ProcessCurrentToken()
    {
        if (this.previousPendingTokenType == TokenConstants.EOF) return;

        this.SetCurrentAndLookAheadTokens();
        if (this.indentationLengthStack.Count == 0) // We're at the first token
        {
            this.HandleStartOfInput();
        }

        switch (this.curToken.Type)
        {
            case PythonLexer.NEWLINE:
                this.HandleNEWLINEtoken();
                break;
            case PythonLexer.LPAR:
            case PythonLexer.LSQB:
            case PythonLexer.LBRACE:
                this.openParenBracketBraceCount++;
                this.AddPendingToken(this.curToken);
                break;
            case PythonLexer.RPAR:
            case PythonLexer.RSQB:
            case PythonLexer.RBRACE:
                this.openParenBracketBraceCount--;
                this.AddPendingToken(this.curToken);
                break;
            case PythonLexer.ERRORTOKEN:
                ReportLexerError($"token recognition error at: '{curToken.Text}'");
                this.AddPendingToken(this.curToken);
                break;
            case TokenConstants.EOF:
                this.HandleEOFtoken();
                break;
            default:
                this.AddPendingToken(this.curToken);
                break;
        }
    }

    private void SetCurrentAndLookAheadTokens()
    {
        this.curToken = this.laToken == null ?
                        base.NextToken() :
                        this.laToken;

        this.laToken = this.curToken.Type == TokenConstants.EOF ?
                        this.curToken :
                        base.NextToken();
    }

    // ===================== Leading‑Token Preprocessing =====================
    // - initialize indent stack with a default 0 indentation length
    // - hide leading NEWLINE(s)
    // - insert leading INDENT if first statement is indented
    private void HandleStartOfInput()
    {
        this.indentationLengthStack.Push(0); // this will never be popped off
        while (this.curToken.Type != TokenConstants.EOF)
        {
            if (this.curToken.Channel == TokenConstants.DefaultChannel)
            {
                if (this.curToken.Type == PythonLexer.NEWLINE)
                {
                    // all the NEWLINE tokens must be ignored before the first statement
                    this.HideAndAddPendingToken(this.curToken);
                }
                else
                { // We're at the first statement
                    this.InsertLeadingIndentToken();
                    return; // continue the processing of the current token with ProcessCurrentToken()
                }
            }
            else
            {
                this.AddPendingToken(this.curToken); // it can be WS, EXPLICIT_LINE_JOINING, or COMMENT token
            }
            this.SetCurrentAndLookAheadTokens();
        } // continue the processing of the EOF token with ProcessCurrentToken()
    }

    private void InsertLeadingIndentToken()
    {
        if (this.previousPendingTokenType == PythonLexer.WS)
        {
            var prevToken = this.pendingTokenQueue.Last!.Value;
            if (this.GetIndentationLength(prevToken.Text) != 0) // there is an "indentation" before the first statement
            {
                const string errMsg = "first statement indented";
                this.ReportLexerError(errMsg);
                // insert an INDENT token before the first statement to trigger an 'unexpected indent' error later in the parser
                this.CreateAndAddPendingToken(PythonLexer.INDENT, PythonLexerBase.ERR_TXT + errMsg, this.curToken);
            }
        }
    }

    // ===================== Indentation Handling =====================
    // Processes NEWLINE tokens, computes indentation length from leading
    // whitespace, manages the INDENT/DEDENT stack, emits the appropriate
    // indentation tokens, and detects inconsistent mixing of tabs and spaces
    private void HandleNEWLINEtoken()
    {
        if (this.openParenBracketBraceCount > 0)
        {
            // We're in an implicit line joining, ignore the current NEWLINE token
            this.HideAndAddPendingToken(this.curToken);
            return;
        }

        var nlToken = new CommonToken(this.curToken); // save the current NEWLINE token
        var isLookingAhead = this.laToken.Type == PythonLexer.WS;
        if (isLookingAhead)
        {
            this.SetCurrentAndLookAheadTokens(); // set the next two tokens
        }

        switch (this.laToken.Type)
        {
            case PythonLexer.NEWLINE: // We're before a blank line
            case PythonLexer.COMMENT: // We're before a comment
                this.HideAndAddPendingToken(nlToken);
                if (isLookingAhead)
                {
                    this.AddPendingToken(this.curToken); // WS token
                }
                break;
            default:
                this.AddPendingToken(nlToken);
                if (isLookingAhead)
                { // We're on whitespace(s) followed by a statement
                    var indentationLength = this.laToken.Type == TokenConstants.EOF ?
                                            0 :
                                            this.GetIndentationLength(this.curToken.Text);

                    if (indentationLength != PythonLexerBase.INVALID_LENGTH)
                    {
                        this.AddPendingToken(this.curToken);  // WS token
                        this.InsertIndentOrDedentToken(indentationLength); // may insert INDENT token or DEDENT token(s)                            
                    }
                    else
                    {
                        this.ReportError("inconsistent use of tabs and spaces in indentation");
                    }
                }
                else
                {
                    // We're at a newline followed by a statement (there is no whitespace before the statement)
                    this.InsertIndentOrDedentToken(0); // may insert DEDENT token(s)
                }
                break;
        }
    }

    private void InsertIndentOrDedentToken(int indentLength)
    {
        var prevIndentLength = this.indentationLengthStack.Peek();
        if (indentLength > prevIndentLength)
        {
            this.CreateAndAddPendingToken(PythonLexer.INDENT, null, this.laToken);
            this.indentationLengthStack.Push(indentLength);
        }
        else
        {
            while (indentLength < prevIndentLength)
            { // more than 1 DEDENT token may be inserted into the token stream
                this.indentationLengthStack.Pop();
                prevIndentLength = this.indentationLengthStack.Peek();
                if (indentLength <= prevIndentLength)
                {
                    this.CreateAndAddPendingToken(PythonLexer.DEDENT, null, this.laToken);
                }
                else
                {
                    this.ReportError("inconsistent dedent");
                }
            }
        }
    }

    private int GetIndentationLength(string indentText) // the indentText may contain spaces, tabs or form feeds
    {
        var length = 0;
        foreach (char ch in indentText)
        {
            switch (ch)
            {
                case ' ':
                    this.wasSpaceIndentation = true;
                    length += 1;
                    break;
                case '\t':
                    this.wasTabIndentation = true;
                    length += PythonLexerBase.TAB_LENGTH - (length % PythonLexerBase.TAB_LENGTH);
                    break;
                case '\f': // form feed
                    length = 0;
                    break;
            }
        }

        if (this.wasTabIndentation && this.wasSpaceIndentation)
        {
            if (!this.hasMixedIndentationBeenReported)
            {
                this.hasMixedIndentationBeenReported = true;
                length = PythonLexerBase.INVALID_LENGTH; // only for the first inconsistent indent
            }
        }
        return length;
    }

    // ===================== Trailing‑Token Finalization =====================
    // Handles end-of-input cleanup, including emission of remaining DEDENT tokens,
    // final NEWLINE normalization, and generation of the EOF token to properly
    // terminate the logical token stream.

    private void InsertTrailingTokens()
    {
        switch (this.lastPendingTokenTypeFromDefaultChannel)
        {
            case PythonLexer.NEWLINE:
            case PythonLexer.DEDENT:
                break; // no trailing NEWLINE token is needed
            default:
                // insert an extra trailing NEWLINE token that serves as the end of the last statement
                this.CreateAndAddPendingToken(PythonLexer.NEWLINE, null, this.laToken); // laToken is EOF
                break;
        }
        this.InsertIndentOrDedentToken(0); // Now insert as many trailing DEDENT tokens as needed
    }

    private void HandleEOFtoken()
    {
        if (this.lastPendingTokenTypeFromDefaultChannel > 0)
        { // there was a statement in the input (leading NEWLINE tokens are hidden)
            this.InsertTrailingTokens();
        }
        this.AddPendingToken(this.curToken);
    }

    // ===================== Pending‑Token Management =====================
    // Manages the queue of pending tokens, including emission of normal and hidden
    // tokens, preserving correct output order for the token stream.
    private void HideAndAddPendingToken(IToken originalToken)
    {
        var token = new CommonToken(originalToken);
        token.Channel = TokenConstants.HiddenChannel;
        this.AddPendingToken(token);
    }

    private void CreateAndAddPendingToken(int ttype, string? text, IToken originalToken)
    {
        var token = new CommonToken(originalToken);
        token.Type = ttype;
        token.Channel = TokenConstants.DefaultChannel;
        token.StopIndex = originalToken.StartIndex - 1;
        token.Text = text ?? "<" + this.Vocabulary.GetSymbolicName(ttype) + ">";

        this.AddPendingToken(token);
    }

    private void AddPendingToken(IToken token)
    {
        // save the last pending token type because the pendingTokenQueue linked list can be empty by the nextToken()
        this.previousPendingTokenType = token.Type;
        if (token.Channel == TokenConstants.DefaultChannel)
        {
            this.lastPendingTokenTypeFromDefaultChannel = this.previousPendingTokenType;
        }
        this.pendingTokenQueue.AddLast(token);
    }

    // ===================== Error Reporting & Diagnostics =====================
    // Provides consistent lexer-level error reporting, including generation of
    // ERRORTOKEN instances, construction of human-readable diagnostic messages,
    // and insertion of error markers into the token stream to ensure that the
    // parser receives accurate context for recovery.

    private void ReportLexerError(string errMsg)
    {
        this.ErrorListenerDispatch.SyntaxError(this.ErrorOutput, this, this.curToken.Type, this.curToken.Line, this.curToken.Column, " LEXER" + PythonLexerBase.ERR_TXT + errMsg, null);
    }

    private void ReportError(string errMsg)
    {
        this.ReportLexerError(errMsg);

        this.CreateAndAddPendingToken(PythonLexer.ERRORTOKEN, PythonLexerBase.ERR_TXT + errMsg, this.laToken);
        // the ERRORTOKEN also triggers a parser error
    }
}
