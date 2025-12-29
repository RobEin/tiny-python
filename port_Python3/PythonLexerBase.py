# The MIT License (MIT)
# Copyright (c) 2021 Robert Einhorn
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

# Project      : A helper class for an ANTLR4 Python lexer grammar that assists in tokenizing indentation
# 
# Developed by : Robert Einhorn

from typing import TextIO
from antlr4 import InputStream, Lexer, Token
from antlr4.Token import CommonToken
import sys
import re

class PythonLexerBase(Lexer):
    def __init__(self, input: InputStream, output: TextIO = sys.stdout):
        super().__init__(input, output)

        # A stack that keeps track of the indentation lengths
        self._indent_length_stack: list[int]

        # A list where tokens are waiting to be loaded into the token stream
        self._pending_tokens: list[CommonToken]

        # Last pending token types
        self._previous_pending_token_type: int
        self._last_pending_token_type_from_default_channel: int

        # Count of open parentheses, square brackets, and curly braces
        self._opened: int

        self._was_space_indentation: bool
        self._was_tab_indentation: bool
        self._was_indentation_mixed_with_spaces_and_tabs: bool

        self._cur_token: CommonToken  # The current token being processed
        self._ffg_token: CommonToken  # The following (lookahead) token

        self._INVALID_LENGTH: int = -1
        self._ERR_TXT: str = " ERROR: "

        self._init()

    def nextToken(self) -> CommonToken:  # Reading the input stream until EOF is reached
        self._check_next_token()
        return self._pending_tokens.pop(0)  # Add the queued token to the token stream

    def reset(self) -> None:
        self._init()
        super().reset()

    def _init(self) -> None:
        self._indent_length_stack = []
        self._pending_tokens = []
        self._previous_pending_token_type = 0
        self._last_pending_token_type_from_default_channel = 0
        self._opened = 0
        self._was_space_indentation = False
        self._was_tab_indentation = False
        self._was_indentation_mixed_with_spaces_and_tabs = False
        self._cur_token = None
        self._ffg_token = None

    def _check_next_token(self) -> None:
        if self._previous_pending_token_type == Token.EOF:
            return

        self._set_current_and_following_tokens()
        if len(self._indent_length_stack) == 0:  # We're at the first token
            self._handle_start_of_input()

        match self._cur_token.type:
            case self.LPAR | self.LSQB | self.LBRACE:
                self._opened += 1
                self._add_pending_token(self._cur_token)
            case self.RPAR | self.RSQB | self.RBRACE:
                self._opened -= 1
                self._add_pending_token(self._cur_token)
            case self.NEWLINE:
                self._handle_NEWLINE_token()
            case self.ERRORTOKEN:
                self._report_lexer_error("token recognition error at: '" + self._cur_token.text + "'")
                self._add_pending_token(self._cur_token)
            case Token.EOF:
                self._handle_EOF_token()
            case other:
                self._add_pending_token(self._cur_token)

    def _set_current_and_following_tokens(self) -> None:
        self._cur_token = super().nextToken() if self._ffg_token is None else \
                            self._ffg_token

        self._ffg_token = self._cur_token if self._cur_token.type == Token.EOF else \
                            super().nextToken()

    # initialize the _indent_length_stack
    # hide the leading NEWLINE token(s)
    # if exists, find the first statement (not NEWLINE, not EOF token) that comes from the default channel
    # insert a leading INDENT token if necessary
    def _handle_start_of_input(self) -> None:
        # initialize the stack with a default 0 indentation length
        self._indent_length_stack.append(0)  # this will never be popped off
        while self._cur_token.type != Token.EOF:
            if self._cur_token.channel == Token.DEFAULT_CHANNEL:
                if self._cur_token.type == self.NEWLINE:
                    # all the NEWLINE tokens must be ignored before the first statement
                    self._hide_and_add_pending_token(self._cur_token)
                else:  # We're at the first statement
                    self._insert_leading_indent_token()
                    return  # continue the processing of the current token with __check_next_token()
            else:
                self._add_pending_token(self._cur_token) # it can be WS, EXPLICIT_LINE_JOINING or COMMENT token
            self._set_current_and_following_tokens()
        # continue the processing of the EOF token with __check_next_token()

    def _insert_leading_indent_token(self) -> None:
        if self._previous_pending_token_type == self.WS:
            prev_token: CommonToken = self._pending_tokens[-1]  # WS token
            if self._get_indentation_length(prev_token.text) != 0: # there is an "indentation" before the first statement
                err_msg: str = "first statement indented"
                self._report_lexer_error(err_msg)
                # insert an INDENT token before the first statement to raise an 'unexpected indent' error later by the parser
                self._create_and_add_pending_token(self.INDENT, Token.DEFAULT_CHANNEL, self._ERR_TXT + err_msg, self._cur_token)

    def _handle_NEWLINE_token(self) -> None:
        if self._opened > 0:  # We're in an implicit line joining, ignore the current NEWLINE token
            self._hide_and_add_pending_token(self._cur_token)
            return

        nl_token: CommonToken = self._cur_token.clone()  # save the current NEWLINE token
        is_looking_ahead: bool = self._ffg_token.type == self.WS
        if is_looking_ahead:
            self._set_current_and_following_tokens()  # set the next two tokens

        match self._ffg_token.type:
            case self.NEWLINE | self.COMMENT:
                # We're before a blank line or a comment or type comment or a type ignore comment
                self._hide_and_add_pending_token(nl_token)  # ignore the NEWLINE token
                if is_looking_ahead:
                    self._add_pending_token(self._cur_token)  # WS token
            case other:
                self._add_pending_token(nl_token)
                if is_looking_ahead: # We're on a whitespace(s) followed by a statement
                    indentation_length: int = 0 if self._ffg_token.type == Token.EOF else \
                                                self._get_indentation_length(self._cur_token.text)

                    if indentation_length != self._INVALID_LENGTH:
                        self._add_pending_token(self._cur_token)  # WS token
                        self._insert_indent_or_dedent_token(indentation_length)  # may insert INDENT token or DEDENT token(s)
                    else:
                        self._report_error("inconsistent use of tabs and spaces in indentation")
                else: # We're at a newline followed by a statement (there is no whitespace before the statement)
                    self._insert_indent_or_dedent_token(0)  # may insert DEDENT token(s)

    def _insert_indent_or_dedent_token(self, indent_length: int) -> None:
        prev_indent_length: int = self._indent_length_stack[-1]  # peek()
        if indent_length > prev_indent_length:
            self._create_and_add_pending_token(self.INDENT, Token.DEFAULT_CHANNEL, None, self._ffg_token)
            self._indent_length_stack.append(indent_length)
        else:
            while indent_length < prev_indent_length:  # more than 1 DEDENT token may be inserted to the token stream
                self._indent_length_stack.pop()
                prev_indent_length = self._indent_length_stack[-1]  # peek()
                if indent_length <= prev_indent_length:
                    self._create_and_add_pending_token(self.DEDENT, Token.DEFAULT_CHANNEL, None, self._ffg_token)
                else:
                    self._report_error("inconsistent dedent")

    def _insert_trailing_tokens(self) -> None:
        match self._last_pending_token_type_from_default_channel:
            case self.NEWLINE | self.DEDENT:
                pass  # no trailing NEWLINE token is needed
            case other:
                # insert an extra trailing NEWLINE token that serves as the end of the last statement
                self._create_and_add_pending_token(self.NEWLINE, Token.DEFAULT_CHANNEL, None, self._ffg_token)  # _ffg_token is EOF
        self._insert_indent_or_dedent_token(0)  # Now insert as much trailing DEDENT tokens as needed

    def _handle_EOF_token(self) -> None:
        if self._last_pending_token_type_from_default_channel > 0:
            # there was statement in the input (leading NEWLINE tokens are hidden)
            self._insert_trailing_tokens()
        self._add_pending_token(self._cur_token)

    def _hide_and_add_pending_token(self, original_token: CommonToken) -> None:
        original_token.channel = Token.HIDDEN_CHANNEL
        self._add_pending_token(original_token)

    def _create_and_add_pending_token(self, ttype: int, channel: int, text: str, original_token: CommonToken) -> None:
        token: CommonToken = original_token.clone()
        token.type  = ttype
        token.channel = channel
        token.stop = original_token.start - 1
        token.text = "<" + self.symbolicNames[ttype] + ">" if text is None else \
                        text

        self._add_pending_token(token)

    def _add_pending_token(self, ctkn: CommonToken) -> None:
        # save the last pending token type because the _pending_tokens list can be empty by the nextToken()
        self._previous_pending_token_type = ctkn.type
        if ctkn.channel == Token.DEFAULT_CHANNEL:
            self._last_pending_token_type_from_default_channel = self._previous_pending_token_type
        self._pending_tokens.append(ctkn)

    def _get_indentation_length(self, indentText: str) -> int:  # the indentText may contain spaces, tabs or form feeds
        TAB_LENGTH: int = 8  # the standard number of spaces to replace a tab to spaces
        length: int = 0
        ch: str
        for ch in indentText:
            match ch:
                case ' ':
                    self._was_space_indentation = True
                    length += 1
                case '\t':
                    self._was_tab_indentation = True
                    length += TAB_LENGTH - (length % TAB_LENGTH)
                case '\f': # form feed
                    length = 0

        if self._was_tab_indentation and self._was_space_indentation:
            if not self._was_indentation_mixed_with_spaces_and_tabs:
                self._was_indentation_mixed_with_spaces_and_tabs = True
                length = self._INVALID_LENGTH  # only for the first inconsistent indent
        return length

    def _report_lexer_error(self, err_msg: str) -> None:
        self.getErrorListenerDispatch().syntaxError(self, self._cur_token.type, self._cur_token.line, self._cur_token.column, " LEXER" + self._ERR_TXT + err_msg, None)

    def _report_error(self, err_msg: str) -> None:
        self._report_lexer_error(err_msg)

        self._create_and_add_pending_token(self.ERRORTOKEN, Token.DEFAULT_CHANNEL, self._ERR_TXT + err_msg, self._ffg_token)
        # the ERRORTOKEN also triggers a parser error
