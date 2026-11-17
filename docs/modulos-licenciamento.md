# Módulos adicionais e licenciamento (contrato para ITSM e Business Game)

Quadros e Planning são a **base** (sempre incluídos). **ITSM** (`itsm`) e **Business Game** (`game`) são **módulos adicionais**, vendidos à parte. Quem libera é o admin da plataforma, em **Administração → Módulos e pacotes** (ou no painel da pessoa, em Usuários e licenças).

## Dados (só admins da plataforma escrevem – regras já em `database.rules.json`)
- `entitlements/ws/<wsId>/<mod> = { on, until|null, plan: "beta"|"trial"|"paid", pkg?, by, at }` → licença da **empresa/workspace**: todo membro ativo daquele workspace usa o módulo nele.
- `entitlements/users/<emailKey>/<mod> = { on, until|null, plan, by, at }` → licença **individual**: a pessoa usa o módulo em qualquer workspace do qual é membro.
- `moduleRequests/<pushId> = { email, name, ws, mod, t }` → pedido de acesso feito pela própria pessoa (aparece para o admin).
- Pacotes (presets do admin): Essencial (base), Serviços (+ITSM), Educação (+Business Game), Empresarial (+ITSM +Business Game).

## Como cada módulo deve usar (`assets/js/modules.js`, já carregado em admin, hub, planning e quadro)
```js
// página do módulo (/itsm/ ou /game/): bloquear sem licença
CMModules.gate("itsm", wsId, document.getElementById("app")).then(function (ok) { if (ok) start(); });
// hub / quadro / admin: mostrar ou não o botão de criar
CMModules.has("game", wsId).then(function (ok) { /* ok → "Nova partida"; senão → botão "Solicitar acesso" */ });
CMModules.forWorkspace(wsId)   // → { itsm: bool, game: bool }
CMModules.request("itsm", wsId) // grava o pedido de acesso
```
- Admin da plataforma sempre tem acesso. Licença expirada (`until` no passado) = sem acesso.
- Sem licença, **não esconder o módulo**: mostrar como "Módulo adicional" com o botão **Solicitar acesso** (é vitrine de venda).
- Ícones sugeridos em `assets/js/icons.js`: `itsm` e `game`.

## Regras do banco dos módulos (cada sessão inclui no nó do seu módulo)
Além de ser membro ativo do workspace, exigir a licença. Expressão (troque `MOD` por `itsm` ou `game` e `WS` pelo caminho do workspace do registro, ex.: `root.child('itsm').child($id).child('info').child('ws').val()`):
```
( root.child('admins').child(auth.token.email.toLowerCase().replace('.', ',')).val() == true
  || ( root.child('entitlements/ws').child(WS).child('MOD/on').val() == true
       && (!root.child('entitlements/ws').child(WS).child('MOD/until').exists() || root.child('entitlements/ws').child(WS).child('MOD/until').val() > now) )
  || ( root.child('entitlements/users').child(auth.token.email.toLowerCase().replace('.', ',')).child('MOD/on').val() == true
       && (!root.child('entitlements/users').child(auth.token.email.toLowerCase().replace('.', ',')).child('MOD/until').exists() || root.child('entitlements/users').child(auth.token.email.toLowerCase().replace('.', ',')).child('MOD/until').val() > now) ) )
```
O Carlos publica as regras no console.

## Administração
- Não mudar o layout do admin. Para aparecer nas contagens da pessoa, incluir os registros do módulo em `buildUsers()` (por acesso, como `boards`/`plans`) e no detalhe do workspace em `wsCard(id)`.
