# Escrita na Mesa

Módulo para Foundry VTT (v12 e v13) que permite escrever direto na cena, em qualquer sistema.

## Instalação
Em **Módulos Complementares → Instalar Módulo**, cole no campo **URL do Manifesto**:
```
https://raw.githubusercontent.com/angelomagnoBR/escrita-na-mesa/main/module.json
```

## Como usar
- Clique na **caneta** nos controles de Token (ou **Alt+T**) e depois clique na mesa onde quer escrever.
- Clique num texto seu (com a caneta ligada) para **editar** ou **apagar**.
- **Girar**: passe o mouse sobre um texto seu e use **Shift + rodinha** (15° por clique), ou ajuste o **Giro** na janela.
- **Moldura**: desligada por padrão. Marque **Moldura** na janela e escolha cor e espessura.
- Fontes incluídas: Máquina de escrever, Caneta pincel, Letra de mão, Cartaz e Faroeste (licenças em `assets/fontes`).

Jogadores sem permissão de desenhar também escrevem: o pedido passa pelo GM conectado, e o texto continua sendo deles.

## Com o Fiasco: Mesa
Se o módulo Fiasco: Mesa estiver no mesmo mundo, a escrita dele se desliga sozinha e este módulo assume. Os textos já criados pelo Fiasco continuam editáveis.
