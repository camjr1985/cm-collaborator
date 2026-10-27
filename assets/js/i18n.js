/*
 * CM Collaborator i18n – English (default) / Português.
 * Pages are written in English; when PT is active, interface text is
 * translated in place. User content (post-its, fields, comments) is never touched.
 * Add a translation: put the exact English text as key in PT below.
 */
(function () {
  "use strict";
  let lang = "en";
  try { lang = localStorage.getItem("cmcollab:lang") || "en"; } catch (e) { /* ignore */ }
  document.documentElement.lang = lang === "pt" ? "pt" : "en";

  const PT = {
    // navigation / site
    "Home": "Início", "Mentoring": "Mentoria", "Open board": "Abrir quadro", "Open Mentoring": "Abrir Mentoria",
    "Features": "Recursos", "How it works": "Como funciona", "Licensing": "Licenciamento", "Mentees": "Mentorados",
    "Visual workspace for mentoring": "Espaço visual para mentoria",
    "Know your mentee. Prioritise what matters. Act together.": "Conheça o seu mentorado. Priorize o que importa. Aja em conjunto.",
    "A collaborative whiteboard built for mentors and their mentees: persona map, priority matrix and RICE scoring on one live canvas.": "Um quadro colaborativo feito para mentores e mentorados: mapa da persona, matriz de priorização e RICE num único canvas ao vivo.",
    "See how it works": "Veja como funciona",
    "Everything a live workshop needs — plus what mentoring needs": "Tudo o que um workshop ao vivo precisa — e o que a mentoria precisa",
    "Infinite canvas": "Canvas infinito", "Pan, zoom, pinch on touch screens, keyboard shortcuts.": "Arrastar, zoom, pinça em ecrãs táteis, atalhos de teclado.",
    "Live collaboration": "Colaboração ao vivo", "Real-time sync, live cursors with names and presence avatars.": "Sincronização em tempo real, cursores ao vivo com nomes e avatares de presença.",
    "Comments & dot voting": "Comentários e votação", "Threads on every post-it and built-in dot voting, free.": "Conversas em cada post-it e votação por pontos incluída.",
    "RICE prioritisation": "Priorização RICE", "Score items and get an automatic ranking across the MoSCoW matrix.": "Pontue itens e obtenha um ranking automático na matriz MoSCoW.",
    "Mentoring templates": "Templates de mentoria", "Persona map, profile study and priority map ready to fill.": "Mapa da persona, estudo de perfil e mapa de prioridades prontos a preencher.",
    "Own your data": "Os dados são seus", "Export / import boards, print to PDF, host on your own GitHub Pages.": "Exportar / importar quadros, imprimir em PDF, hospedar no seu GitHub Pages.",
    "Profile Study": "Estudo de Perfil", "Priority Map": "Mapa de Prioridades", "Action plan": "Plano de ação",
    "The mentee fills the persona map: motivations, challenges, goals, skills, family and what drives them.": "O mentorado preenche o mapa da persona: motivações, desafios, objetivos, skills, família e o que o move.",
    "Together you move the key topics into Must / Should / Could / Won't have.": "Juntos, movem os temas-chave para Must / Should / Could / Won't have.",
    "Score with RICE and dot voting – the ranking tells you what to attack first.": "Pontuem com RICE e votação – o ranking mostra o que atacar primeiro.",
    "For mentors, schools and companies": "Para mentores, escolas e empresas",
    "CM Collaborator will be available under licence, with private boards per mentee and access for students.": "O CM Collaborator será disponibilizado por licença, com quadros privados por mentorado e acesso para alunos.",
    "Mentor": "Mentor", "Academy": "Academia", "Enterprise": "Empresa",
    "Unlimited mentee boards": "Quadros de mentorados ilimitados", "All templates": "Todos os templates", "Export & PDF": "Exportação e PDF",
    "Student access by cohort": "Acesso de alunos por turma", "Shared template library": "Biblioteca de templates partilhada", "Mentor dashboard": "Painel do mentor",
    "Single sign-on": "Login único (SSO)", "Custom branding": "Marca personalizada", "Dedicated support": "Suporte dedicado",
    "Request access": "Pedir acesso", "Coming soon": "Em breve",
    "Mentoring programme": "Programa de mentoria",
    "Each mentee gets a private board with the Persona Map and the Priority Map.": "Cada mentorado recebe um quadro privado com o Mapa da Persona e o Mapa de Prioridades.",
    "Persona Map · Priority Map": "Mapa da Persona · Mapa de Prioridades", "Active": "Ativo", "Template": "Template",
    "Add a mentee": "Adicionar mentorado",
    "Copy the folder mentoring/joaquim-ventura, rename it and change the board id and name in its index.html.": "Copie a pasta mentoring/joaquim-ventura, renomeie-a e altere o id e o nome do quadro no index.html.",
    "The journey": "A jornada", "Step": "Etapa",
    "Built by": "Criado por", "Programme, Delivery & PMO executive": "Executivo de Programas, Delivery e PMO",

    // board chrome
    "Share": "Partilhar", "Timer": "Timer", "Session timer": "Timer da sessão",
    "Add post-it (N)": "Adicionar post-it (N)", "Add post-it": "Adicionar post-it", "Undo (Ctrl+Z)": "Desfazer (Ctrl+Z)", "Redo (Ctrl+Shift+Z)": "Refazer (Ctrl+Shift+Z)",
    "Export board (JSON)": "Exportar quadro (JSON)", "Import board (JSON)": "Importar quadro (JSON)", "Print / save as PDF": "Imprimir / guardar PDF",
    "Reset board": "Reiniciar quadro", "How to use": "Como usar", "Zoom out": "Diminuir zoom", "Zoom in": "Aumentar zoom", "Fit board (F)": "Ajustar ao ecrã (F)",
    "Reset to 100%": "Voltar a 100%", "Change colour": "Mudar cor", "Vote (dot voting)": "Votar", "Remove my vote": "Remover o meu voto",
    "Comments": "Comentários", "RICE score": "Pontuação RICE", "Duplicate (Ctrl+D)": "Duplicar (Ctrl+D)", "Delete (Del)": "Apagar (Del)",
    "Ranking": "Ranking", "Votes": "Votos", "Close": "Fechar", "Ranking & comments": "Ranking e comentários", "Resize": "Redimensionar",
    "Remove photo": "Remover foto", "Photo": "Foto", "Add a family photo": "Adicionar foto da família",
    "Live": "Ao vivo", "Local": "Local", "Real-time collaboration on": "Colaboração em tempo real ativa",
    "Saved in this browser. Click for collaboration options.": "Guardado neste navegador. Clique para opções de colaboração.",
    "Double-click to write": "Duplo clique para escrever",
    "(empty post-it)": "(post-it vazio)",

    // template
    "What motivated you to seek mentoring?": "O que te motivou a buscar a mentoria?",
    "Which challenges do you want to overcome with this mentoring?": "Quais desafios você pretende vencer com a mentoria?",
    "What are your goals for this mentoring?": "Quais são os seus objetivos para a mentoria?",
    "Knowledge to be applied": "Conhecimentos a serem aplicados",
    "Double-click to add a post-it": "Duplo clique para adicionar um post-it",
    "Name:": "Nome:", "Role:": "Função:", "City:": "Cidade:", "Your current role": "A sua função atual", "City - Country": "Cidade - País",
    "My family": "Minha família", "I graduated in…": "Eu sou graduado em…", "I work at…": "Eu trabalho na…", "I live in…": "Eu moro em…",
    "Skills Profile": "Skills Profile", "Want to develop": "Quero desenvolver", "Practising": "Pratico", "Mastered": "Domino",
    "Place each skill post-it on the ring that fits: centre = mastered": "Coloque cada skill no anel certo: centro = domino",
    "I like…": "Eu gosto de…", "I don't like…": "Eu não gosto de…", "What makes me happy": "O que me faz feliz",
    "Favourite food": "Comida favorita", "Holidays · dream trip": "Férias · viagem dos sonhos", "Hobbies · favourite games": "Hobbies · jogos favoritos",
    "Personal improvement opportunities": "Oportunidades de melhorias pessoais",
    "Must be done no matter what. Top priority.": "Preciso fazer de todas as formas, prioridade máxima.",
    "Should be prioritised.": "Deveria ser priorizado.", "Could be done if there is time (capacity).": "Poderia ter caso haja tempo (capacity).",
    "No need to do it now.": "Não terá necessidade de ser realizado agora.",
    "Reach × Impact × Confidence": "Alcance × Impacto × Confiança", "Effort": "Esforço", "= RICE SCORE": "= RICE SCORE",
    "Select a post-it and click ": "Selecione um post-it e clique em ", " to score it. The ": " para pontuá-lo. O painel ",
    " panel orders everything automatically.": " ordena tudo automaticamente.",

    // panel
    "Post-its placed in the Priority Map or scored with RICE, ordered by RICE score.": "Post-its no Mapa de Prioridades ou com RICE, ordenados pela pontuação RICE.",
    "Drag post-its into the Must / Should / Could / Won't boxes and score them with RICE.": "Arraste post-its para Must / Should / Could / Won't e pontue-os com RICE.",
    "No votes yet.": "Ainda sem votos.", "Clear my votes": "Limpar os meus votos",
    "No comments yet. Start the conversation.": "Ainda sem comentários. Comece a conversa.",
    "Write a comment… (Enter to send)": "Escreva um comentário… (Enter para enviar)", "Send": "Enviar", "delete": "apagar",
    "Select a post-it to read or add comments.": "Selecione um post-it para ler ou adicionar comentários.",
    "No comments on this board yet.": "Ainda não há comentários neste quadro.", "just now": "agora mesmo", "Guest": "Convidado",

    // modals
    "Welcome to the board 👋": "Bem-vindo ao quadro 👋", "Your name appears on your cursor, post-its and comments.": "O seu nome aparece no cursor, nos post-its e nos comentários.",
    "Your name": "O seu nome", "Enter board": "Entrar no quadro", "Colour": "Cor",
    "How to use this board": "Como usar este quadro", "Got it": "Entendi",
    "Add a post-it:": "Adicionar post-it:", " double-click any empty spot, or use the post-it tool on the left (N). It takes the colour of the area you click.": " duplo clique num espaço vazio, ou use a ferramenta de post-it à esquerda (N). Ele assume a cor da área clicada.",
    "Write:": "Escrever:", " double-click a post-it. Click outside to finish.": " duplo clique num post-it. Clique fora para terminar.",
    "Move / resize:": "Mover / redimensionar:", " drag the post-it, or its bottom-right corner.": " arraste o post-it, ou o canto inferior direito.",
    "Navigate:": "Navegar:", " drag the background to pan, scroll or pinch to zoom, F to fit.": " arraste o fundo para mover, role ou use pinça para zoom, F para ajustar.",
    "Photos & profile:": "Fotos e perfil:", " click the photo frames and the Name / Role / City fields.": " clique nas molduras de foto e nos campos Nome / Função / Cidade.",
    "Prioritise:": "Priorizar:", " drag post-its into Must / Should / Could / Won't, score them with ": " arraste post-its para Must / Should / Could / Won't, pontue com ",
    " and use ": " e use ", "dot voting": "votação por pontos", ". The Ranking panel orders everything.": ". O painel Ranking ordena tudo.",
    "Collaborate:": "Colaborar:", " comments on any post-it, live cursors, shared timer and Share link.": " comentários em qualquer post-it, cursores ao vivo, timer partilhado e link de partilha.",
    "Shortcuts:": "Atalhos:", " Del delete · Ctrl+D duplicate · Ctrl+Z / Ctrl+Shift+Z undo / redo · Esc deselect.": " Del apagar · Ctrl+D duplicar · Ctrl+Z / Ctrl+Shift+Z desfazer / refazer · Esc desselecionar.",
    "Reach": "Alcance", "How many people / times per period?": "Quantas pessoas / vezes por período?",
    "Impact": "Impacto", "How much will it move the needle?": "Quanto vai fazer a diferença?",
    "Confidence": "Confiança", "How sure are you about these estimates?": "Quão seguro está destas estimativas?",
    "Person-weeks (or any consistent unit)": "Pessoa-semanas (ou outra unidade consistente)",
    "3 · Massive": "3 · Enorme", "2 · High": "2 · Alto", "1 · Medium": "1 · Médio", "0.5 · Low": "0,5 · Baixo", "0.25 · Minimal": "0,25 · Mínimo",
    "100% · High": "100% · Alta", "80% · Medium": "80% · Média", "50% · Low": "50% · Baixa", "20% · Moonshot": "20% · Aposta",
    "Score: ": "Pontuação: ", "Remove score": "Remover pontuação", "Cancel": "Cancelar", "Save": "Guardar",
    "Shared with everyone on the board.": "Partilhado com todos no quadro.", "Stop timer": "Parar timer",
    "Share this board": "Partilhar este quadro", "Anyone with this link can view and edit in real time.": "Quem tiver este link pode ver e editar em tempo real.",
    "This board is in ": "Este quadro está em ", "local mode": "modo local",
    ": changes are saved in this browser only. To collaborate in real time across devices, add your Firebase config to ": ": as alterações ficam só neste navegador. Para colaborar em tempo real entre dispositivos, adicione a configuração Firebase em ",
    " (see README). Meanwhile you can exchange the board as a file.": " (ver README). Entretanto, pode trocar o quadro como ficheiro.",
    "Copy link": "Copiar link", "Export board file": "Exportar ficheiro do quadro", "Import board file": "Importar ficheiro do quadro",
    "Reset board?": "Reiniciar quadro?", "All post-its, fields and photos will be replaced by the empty template. Export first if you want a backup.": "Todos os post-its, campos e fotos serão substituídos pelo template vazio. Exporte antes se quiser uma cópia.",
    "Reset": "Reiniciar", "Import board?": "Importar quadro?", "This replaces the current content of the board for everyone.": "Isto substitui o conteúdo atual do quadro para todos.",
    "Replace board": "Substituir quadro",

    // toasts
    "Nothing to undo": "Nada para desfazer", "Nothing to redo": "Nada para refazer", "Link copied": "Link copiado", "Board exported": "Quadro exportado",
    "Board imported": "Quadro importado", "Board reset": "Quadro reiniciado", "RICE score saved": "Pontuação RICE guardada",
    "That file is not a CM Collaborator export": "Este ficheiro não é uma exportação do CM Collaborator", "Could not read that image": "Não foi possível ler a imagem",
    "⏰ Time's up!": "⏰ O tempo acabou!", "Browser storage is full – export the board to keep a copy": "O armazenamento do navegador está cheio – exporte o quadro para guardar uma cópia",
    "Could not connect to the live server – check config.js": "Não foi possível ligar ao servidor ao vivo – verifique o config.js",
    "Sign in": "Entrar",
    "Sign out": "Sair",
    "My boards": "Os meus quadros",
    "Administration": "Administração",
    "Admin": "Admin",
    "Invited": "Convidado",
    "Boards are private. Only people invited by the mentor can open them.": "Os quadros são privados. Só quem foi convidado pelo mentor pode abri-los.",
    "Continue with Google": "Continuar com Google",
    "or": "ou",
    "E-mail": "E-mail",
    "Send me a sign-in link": "Enviar-me um link de acesso",
    "Sending…": "A enviar…",
    "Check your inbox: we sent you a sign-in link. Open it on this device.": "Veja a sua caixa de entrada: enviámos um link de acesso. Abra-o neste dispositivo.",
    "Signed in as": "Sessão iniciada como",
    "No boards yet": "Ainda sem quadros",
    "Create the first board in Administration.": "Crie o primeiro quadro na Administração.",
    "Ask your mentor to invite this e-mail address.": "Peça ao seu mentor para convidar este e-mail.",
    "Loading…": "A carregar…",
    "Demo mode.": "Modo demonstração.",
    "Sign-in and private access switch on as soon as Firebase is configured (see README). Until then, boards are saved only in your browser.": "O login e o acesso privado ficam ativos assim que o Firebase for configurado (ver README). Até lá, os quadros ficam guardados só no seu navegador.",
    "Demo": "Demo",
    "Boards & access": "Quadros e acessos",
    "Create private boards and decide who can open them. Only you can grant access.": "Crie quadros privados e decida quem os pode abrir. Só você concede acesso.",
    "Setup required": "Configuração necessária",
    "Private access needs Firebase. Follow these steps once:": "O acesso privado precisa do Firebase. Siga estes passos uma vez:",
    "Administrator": "Administrador",
    "New board": "Novo quadro",
    "Creates a private board and gives access to the mentee.": "Cria um quadro privado e dá acesso ao mentorado.",
    "Mentee name": "Nome do mentorado",
    "Mentee e-mail": "E-mail do mentorado",
    "Board id (link)": "Id do quadro (link)",
    "Access": "Acesso",
    "Can edit": "Pode editar",
    "View only": "Só visualizar",
    "Create board & grant access": "Criar quadro e dar acesso",
    "Overview": "Resumo",
    "Boards": "Quadros",
    "People with access": "Pessoas com acesso",
    "Only e-mails listed on a board can open it. Admins are managed in the Firebase console.": "Só os e-mails listados num quadro o podem abrir. Os administradores são geridos na consola do Firebase.",
    "No boards yet. Create the first one above.": "Ainda sem quadros. Crie o primeiro acima.",
    "Copy link": "Copiar link",
    "Delete": "Apagar",
    "Invite": "Convidar",
    "Remove": "Remover",
    "No one has access yet.": "Ninguém tem acesso ainda.",
    "Name": "Nome",
    "Grant access": "Dar acesso",
    "Send this message to the person. They sign in with the invited e-mail and the board opens.": "Envie esta mensagem à pessoa. Ela entra com o e-mail convidado e o quadro abre.",
    "Copy message": "Copiar mensagem",
    "Open in e-mail": "Abrir no e-mail",
    "Fill in the mentee name": "Preencha o nome do mentorado",
    "Enter a valid e-mail": "Introduza um e-mail válido",
    "A board with this id already exists": "Já existe um quadro com este id",
    "Board created and access granted": "Quadro criado e acesso concedido",
    "Access granted": "Acesso concedido",
    "Access removed": "Acesso removido",
    "Role updated": "Permissão atualizada",
    "Board deleted": "Quadro apagado",
    "Message copied": "Mensagem copiada",
    "Remove access for": "Remover acesso de",
    "This permanently deletes the board and its content. Type the board id to confirm:": "Isto apaga o quadro e o conteúdo para sempre. Escreva o id do quadro para confirmar:",
    "Sign in required": "É preciso entrar",
    "Administration is only for the account owner.": "A administração é só para o dono da conta.",
    "Admins only": "Só administradores",
    "Error": "Erro",
    "Loading": "A carregar",
    "Checking your access to this board.": "A verificar o seu acesso a este quadro.",
    "This board is private. Sign in with the e-mail address the mentor invited.": "Este quadro é privado. Entre com o e-mail que o mentor convidou.",
    "Board not found": "Quadro não encontrado",
    "This link is incomplete. Open your boards from the Mentoring page.": "Este link está incompleto. Abra os seus quadros na página Mentoria.",
    "This board does not exist or was removed.": "Este quadro não existe ou foi removido.",
    "No access": "Sem acesso",
    "Use another account": "Usar outra conta",
    "Sign out?": "Sair?",
    "You will need to sign in again to open this board.": "Vai precisar de entrar novamente para abrir este quadro.",
    "View only – you can read this board but not edit it": "Só visualização – pode ler este quadro mas não editar",
    "Not saved – you don't have permission to edit": "Não guardado – não tem permissão para editar",
    "Confirm your e-mail to finish signing in": "Confirme o seu e-mail para concluir a entrada",
    "Sign in with": "Entrar com",
    "People on this board": "Pessoas neste quadro", "Tools": "Ferramentas"
  };

  const PATTERNS = [
    [/^Added by (.+)$/, "Adicionado por $1"],
    [/^(\d+) vote\(s\)$/, "$1 voto(s)"],
    [/^(\d+) comment\(s\)$/, "$1 comentário(s)"],
    [/^You have used all (\d+) votes$/, "Já usou os seus $1 votos"],
    [/^(\d+) vote\(s\) left$/, "Restam $1 voto(s)"],
    [/^Dot voting: everyone has (\d+) votes\. You have $/, "Votação por pontos: cada pessoa tem $1 votos. Ainda tem "],
    [/^ left\. Select a post-it and press the dot to vote\.$/, " por usar. Selecione um post-it e clique no ponto para votar."],
    [/^(\d+)m ago$/, "há $1 min"], [/^(\d+)h ago$/, "há $1 h"],
    [/^(.+) \(you\)$/, "$1 (você)"],
    [/^(\d+) min$/, "$1 min"],
    [/^Your account \((.+)\) doesn't have access to this board\. Ask the mentor for an invitation\.$/, "A sua conta ($1) não tem acesso a este quadro. Peça um convite ao mentor."],
    [/^Your account \((.+)\) is not an administrator\.$/, "A sua conta ($1) não é administradora."]
  ];

  function tr(s) {
    if (lang !== "pt" || !s) return s;
    if (Object.prototype.hasOwnProperty.call(PT, s)) return PT[s];
    const trimmed = s.trim();
    if (trimmed !== s && Object.prototype.hasOwnProperty.call(PT, trimmed)) return s.replace(trimmed, PT[trimmed]);
    for (let i = 0; i < PATTERNS.length; i++) if (PATTERNS[i][0].test(s)) return s.replace(PATTERNS[i][0], PATTERNS[i][1]);
    return s;
  }
  window.MBt = tr;
  window.MB_LANG = lang;

  const SKIP = ".txt,[data-field],.cmt-text,.rank-t,.thread-head,.cursor,.no-i18n,input,textarea,script,style";
  const ATTRS = ["title", "placeholder", "aria-label", "data-ph"];
  function skip(node) { const el = node.nodeType === 1 ? node : node.parentElement; return !el || !!el.closest(SKIP); }
  function walk(root) {
    if (lang !== "pt" || !root) return;
    if (root.nodeType === 3) { if (!skip(root)) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || skip(root)) return;
    ATTRS.forEach(function (a) { if (root.hasAttribute(a)) { const v = tr(root.getAttribute(a)); if (v !== root.getAttribute(a)) root.setAttribute(a, v); } });
    // keep placeholders on form fields translated too
    root.querySelectorAll("input[placeholder],textarea[placeholder]").forEach(function (i) { i.placeholder = tr(i.placeholder); });
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) { return skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
      else ATTRS.forEach(function (a) { if (n.hasAttribute(a)) { const v = tr(n.getAttribute(a)); if (v !== n.getAttribute(a)) n.setAttribute(a, v); } });
    }
  }

  function setLang(l) {
    try { localStorage.setItem("cmcollab:lang", l); } catch (e) { /* ignore */ }
    location.reload();
  }
  window.MBSetLang = setLang;

  function mountSwitch() {
    document.querySelectorAll("[data-lang-switch]").forEach(function (box) {
      if (box.dataset.ready) return;
      box.dataset.ready = "1";
      box.classList.add("no-i18n");
      box.innerHTML = '<button type="button" data-l="en" aria-pressed="' + (lang === "en") + '">EN</button><button type="button" data-l="pt" aria-pressed="' + (lang === "pt") + '">PT</button>';
      box.addEventListener("click", function (e) { const b = e.target.closest("button"); if (b && b.dataset.l !== lang) setLang(b.dataset.l); });
    });
  }

  function start() {
    mountSwitch();
    walk(document.body);
    if (document.title) document.title = tr(document.title);
    const mo = new MutationObserver(function (muts) {
      mountSwitch();
      if (lang !== "pt") return;
      mo.disconnect();
      muts.forEach(function (m) {
        if (m.type === "characterData") walk(m.target);
        else if (m.type === "attributes") walk(m.target);
        else m.addedNodes.forEach(walk);
      });
      observe();
    });
    function observe() { mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
    observe();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
