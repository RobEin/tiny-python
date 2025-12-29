// ******* GRUN (Grammar Unit Test) for Python *******

'use strict';

import { CharStreams, CommonTokenStream, Token } from "antlr4";
import PythonLexer from "./PythonLexer.js";
import PythonParser from "./PythonParser.js";

class grun4py {
    static replaceSpecialCharacters(text) {
        return text.replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t")
            .replace(/\f/g, "\\f");

    }

    static formatToken(token) {
        const tokenText = this.replaceSpecialCharacters(token.text);
        const tokenName = token.type == Token.EOF ? "EOF" : PythonLexer.symbolicNames[token.type] ?? "";
        const channelText = token.channel == Token.DEFAULT_CHANNEL ?
            "" :
            `channel=${PythonLexer.channelNames[token.channel]},`;

        // original format: [@tokenIndex,start:stop='tokenText',<tokenType>,channel=channelNumber,line:column]
        // modified format: [@tokenIndex,start:stop='tokenText',<tokenName>,channel=channelName,line:column]
        return `[@${token.tokenIndex},${token.start}:${token.stop}='${tokenText}',<${tokenName}>,${channelText}${token.line}:${token.column}]`;
    }

    static async main(filePath) {
        if (process.argv.length < 3) {
            console.error('Error: Please provide an input file path');
            process.exit(1);
        }

        try {
            const input = CharStreams.fromPathSync(filePath, "utf-8");
            const lexer = new PythonLexer(input);
            const tokens = new CommonTokenStream(lexer);
            const parser = new PythonParser(tokens);

            tokens.fill(); // Test the lexer grammar
            for (const token of tokens.tokens) {
                console.log(this.formatToken(token));
            }

            parser.file_input(); // Test the parser grammar
            process.exit(parser.syntaxErrorsCount);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`Error:\n${error.message}`);
            } else {
                console.error('An unknown error occurred');
            }
            process.exit(1);
        }
    }
}

grun4py.main(process.argv[2]);