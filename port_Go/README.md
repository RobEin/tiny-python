### Go implementation

#### Prerequisites:
- Installed [ANTLR4-tools](https://github.com/antlr/antlr4/blob/master/doc/getting-started.md#getting-started-the-easy-way-using-antlr4-tools)
- Installed [Dart](https://dart.dev/get-dart)

#### Command line example:
    first:
     - create the go.mod file
     - download the ANTLR4 package
     - copy the two grammar files and the example.py to this directory

```bash
    go mod init GoLang
    go get github.com/antlr4-go/antlr
``` 

Unix:
```bash
    cp ../*.g4 ./parser
    cp ../example.py .
```

Windows:
```bash
    copy ..\*.g4 .\parser
    copy ..\example.py
```

```bash
go generate ./...
go mod tidy
go run gogrun4py.go example.py
```

#### Related link:
[Go target](https://github.com/antlr/antlr4/blob/dev/doc/go-target.md)
