# OpenAPI Example Check

Verificador offline de exemplos explícitos de corpos JSON de requisição e resposta contra um **recorte documentado de OpenAPI 3.1.1 e JSON Schema 2020-12**. Projeto da [Lofrano Tecnologia](https://lofranotecnologia.com.br), sob o proprietário GitHub [martinlofranodeoliveira](https://github.com/martinlofranodeoliveira).

Não é um validador completo de OpenAPI. Não chama uma API, não inicia servidor HTTP, não extrai exemplos embutidos e não comprova o comportamento de um serviço. Todos os dados incluídos são sintéticos. Não há credenciais, telemetria, chamadas de modelos ou dependência de rede durante a execução.

## Instalar, testar e demonstrar

Use Node.js 22 ou superior e npm. No diretório do projeto:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run demo
npm run cli -- examples/api.json examples/valid-cases.json
```

Dependências diretas fixadas: Ajv 8.17.1 em execução; TypeScript 7.0.2 e `@types/node` 22.20.5 somente no desenvolvimento. O `package-lock.json` gerado está incluído; use `npm ci --ignore-scripts --no-audit --no-fund` nas instalações seguintes com lock. Os testes compilam com verificação estrita, incluindo as declarações das dependências, antes de executar `node --test`. Depois da instalação, testes e demonstração não precisam de acesso externo à rede.

O comando da CLI acima imprime, após os cabeçalhos do npm:

```json
{
  "valid": true,
  "cases_checked": 3,
  "errors": []
}
```

Para obter **somente** JSON na saída, compile uma vez e execute diretamente:

```sh
npm run build
node build/src/cli.js examples/api.json examples/invalid-cases.json
```

Esse comando termina com código 1. A primeira falha é:

```json
{
  "case_id": "a-missing",
  "operationId": "createOrder",
  "kind": "request",
  "instance_path": "",
  "code": "required"
}
```

O relatório completo contém quatro falhas ordenadas pelo ID: `a-missing/required`, `b-type/type` em `/items/0/quantity`, `c-enum/enum` em `/state` e `d-extra/additionalProperties` na raiz. Diagnósticos de respostas também contêm o `status` exato. Valores dos corpos, membros de enum, documentos de schema e mensagens do Ajv não são incluídos.

`npm run demo` mostra títulos legíveis, os dois relatórios JSON completos e a mensagem `Expected outcomes confirmed; no network requests were made.` A demonstração verifica contagens, IDs, palavras-chave e caminhos esperados. Termina com 0 quando os exemplos deliberadamente inválidos falham como previsto.

## Dois arquivos explícitos

O primeiro arquivo é JSON de OpenAPI com `openapi` exatamente `3.1.1`, operações em `paths` e schemas de corpos JSON. Exemplo:

```json
{
  "openapi": "3.1.1",
  "paths": {
    "/synthetic": {
      "post": {
        "operationId": "submit",
        "requestBody": {
          "content": { "application/json": { "schema": { "type": "integer" } } }
        },
        "responses": {
          "200": {
            "description": "Resultado sintético",
            "content": { "application/json": { "schema": { "type": "string" } } }
          }
        }
      }
    }
  }
}
```

O arquivo separado de casos é:

```json
{
  "cases": [
    { "id": "a-request", "operationId": "submit", "kind": "request", "payload": 7 },
    { "id": "b-response", "operationId": "submit", "kind": "response", "status": "200", "payload": "synthetic-result" }
  ]
}
```

Cada ID é único. `status` é obrigatório somente para respostas e proibido em requisições. Deve ser string, não número. Os casos são ordenados pelo ID antes da seleção e do relatório. Não existe fallback para respostas curinga ou `default`.

## Biblioteca

Após `npm run build`, um consumidor CommonJS local pode usar:

```js
const { checkFiles, CheckError } = require('./build/src/index.js');

checkFiles('examples/api.json', 'examples/valid-cases.json')
  .then(report => console.log(JSON.stringify(report)))
  .catch(error => {
    console.error(error instanceof CheckError ? error.code : 'unexpected');
    process.exitCode = 2;
  });
```

`checkDocuments(openapi, suite)` é a API síncrona em memória. Retorna o mesmo relatório para divergências dos corpos e lança `CheckError` para problemas de configuração. `parseJsonDocument(text)` aplica os limites de entrada JSON. A compilação emite declarações públicas. Consulte o [contrato estável](docs/contract.md), em inglês.

## Recorte suportado e políticas

- O **validador 2020-12 do Ajv em modo estrito** valida schemas e dados. O projeto não reimplementa JSON Schema.
- São aceitos schemas inline booleanos/objetos e referências locais `#/components/schemas/Name`. Nomes seguem `[A-Za-z][A-Za-z0-9_]{0,63}`. As referências são reescritas para um registro privado em memória. Recursão por propriedades ou itens é aceita; ciclos que não consomem dados são rejeitados.
- As palavras-chave suportadas abrangem `type` simples, `properties`, `required`, `additionalProperties` booleano, `items` homogêneo, limites de tamanho de arrays/strings, limites numéricos/múltiplos, `enum` primitivo e `const` primitivo. A lista exata está no contrato. Não são habilitados expressões regulares, combinadores, tuplas, schemas em propriedades adicionais, palavras-chave customizadas ou plugins de formato.
- `readOnly`, `writeOnly`, `default`, `title` e `description` são anotações. Não implementam controle de acesso de requisição/resposta. Não há coerção, inserção de defaults ou remoção de campos adicionais. Todo `format`, inclusive formatos conhecidos, é rejeitado em vez de ignorado silenciosamente.
- A ausência de declaração de dialeto significa 2020-12 **neste recorte**, não o dialeto padrão geral de OpenAPI. `jsonSchemaDialect` e `$schema`, quando presentes, precisam ser exatamente `https://json-schema.org/draft/2020-12/schema`.
- Todas as operações HTTP encontradas precisam de `operationId` único no formato documentado. Todos os componentes e os schemas de corpos selecionados são verificados. Corpos não selecionados, parâmetros, segurança, cabeçalhos, callbacks e exemplos embutidos não são validados.
- Um corpo selecionado precisa ter exatamente um tipo de mídia: `application/json`. Reference Objects de requestBody/resposta, referências externas, âncoras, outros formatos de JSON Pointer, versões/dialetos não suportados e IDs não resolvidos são erros de configuração. Schemas remotos e exemplos externos nunca são buscados.

## Limites e códigos de saída

Por documento: 1.048.576 bytes UTF-8, 20.000 nós de valores JSON e profundidade 64. Uma suíte tem 1–128 casos; a profundidade de cada corpo é no máximo 32. Considerando todos os componentes mais os schemas selecionados distintos: 256 nós de schema, 64 ocorrências de referência, profundidade de cadeia de referências 16, 4.096 visitas de expansão de referências e até 64 valores primitivos por enum. A raiz tem profundidade zero. Nomes de propriedades têm até 64 unidades UTF-16; três nomes sensíveis a protótipos são rejeitados. A contagem exata está no contrato.

A CLI emite um relatório JSON em stdout, sem erros brutos de I/O:

| Código | Significado |
| --- | --- |
| 0 | Todos os casos fornecidos são válidos |
| 1 | Há divergências nos corpos; todos os casos foram verificados |
| 2 | Falha de uso, I/O, configuração ou limite; sem resultado parcial |

Apenas a primeira falha do Ajv por caso é relatada, limitando a saída. Números seguem a semântica normal de JavaScript; chaves JSON repetidas seguem o comportamento de última chave de `JSON.parse`. Não há prazo máximo de execução nem promessa de execução multiusuário segura de schemas hostis; nesse cenário, isole o processo e aplique prazos externos. Veja [desenho](docs/design.md) e [segurança](SECURITY.md).

## Diferença em relação a http-fixture-lab

A distinção é validação por schema versus interação HTTP. OpenAPI Example Check recebe dois arquivos e verifica valores de corpos contra schemas selecionados. Não reproduz nem serve fixtures HTTP, não compara requisições reais e não verifica transporte. Uma ferramenta orientada a fixtures, como `http-fixture-lab`, atua em outra camada. A aprovação destes casos não comprova entrega de status HTTP, cabeçalhos, latência ou comportamento de um serviço em execução.

## Estado e licença

0.1.0 ainda não lançada; sem alegações de implantação, certificação ou prontidão para produção. MIT, copyright 2026 Lofrano Tecnologia. Consulte [contribuição](CONTRIBUTING.md), [histórico](CHANGELOG.md) e [English](README.md).
