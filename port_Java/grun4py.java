// ******* GRUN (Grammar Unit Test) for Python *******

import org.antlr.v4.runtime.*;

import java.io.*;
import java.nio.charset.Charset;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

public class grun4py {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("Error: Please provide an input file path");
            System.exit(1);
        }

        try {
            final Path path = Paths.get(args[0]);
            CharStream input = CharStreams.fromPath(path, Charset.forName("utf-8"));
            PythonLexer lexer = new PythonLexer(input);
            CommonTokenStream tokens = new CommonTokenStream(lexer);
            PythonParser parser = new PythonParser(tokens);

            tokens.fill(); // Test the lexer grammar
            for (Token t : tokens.getTokens()) {
                System.out.println(formatToken(t));
            }

            parser.file_input(); // Test the parser grammar
            System.exit(parser.getNumberOfSyntaxErrors());

        } catch (Exception ex) {
            System.err.println("Error: " + ex.getMessage());
            System.exit(1); // Error occurred, returning non-zero exit code
        }
    }

    private static String formatToken(Token token) {
        String tokenText = replaceSpecialCharacters(token.getText());
        String tokenName = token.getType() == Token.EOF ? "EOF" : PythonLexer.VOCABULARY.getSymbolicName(token.getType());
        String channelText = token.getChannel() == Token.DEFAULT_CHANNEL ?
                             "" :
                             "channel=" + PythonLexer.channelNames[token.getChannel()] + ",";

        // Modified format: [@TokenIndex,StartIndex:StopIndex='Text',<TokenName>,channel=ChannelName,Line:Column]
        return String.format("[@%d,%d:%d='%s',<%s>,%s%d:%d]",
                             token.getTokenIndex(), token.getStartIndex(), token.getStopIndex(),
                             tokenText, tokenName, channelText, token.getLine(), token.getCharPositionInLine());
    }

    private static String replaceSpecialCharacters(String text) {
        return text.replace("\n", "\\n")
               .replace("\r", "\\r")
               .replace("\t", "\\t")
               .replace("\f", "\\f");

    }
}
