import org.antlr.v4.runtime.*;

public class Main {
    public static void main(String[] args) throws Exception {
        CharStream input = CharStreams.fromFileName(args[0]);
        LexerWithIndentDedentInjector lexer = new LexerWithIndentDedentInjector(input);
        for (Token t: lexer.getAllTokens()) {
            System.out.println(t.toString());
        }
        System.out.println();
        System.out.println(input.toString());
    }
}
