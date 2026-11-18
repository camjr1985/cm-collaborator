/* CM Collaborator – Business Game: the areas (cases) offered in "Start something new" on My boards (hub.js reads window.CMGameAreas).
 * Project management cases come first (default mode); company/market scenarios stay available as "Business management". */
(function () {
  "use strict";
  const L = function (en, pt) { return window.MBL ? window.MBL(en, pt) : pt; };
  window.CMGameAreas = {
    lancamento: { mode: "project", name: L("Product launch", "Lançamento de produto"), desc: L("Project management: a consumer goods maker launches a new product line within the commercial window – scope, schedule, budget, quality and risks.", "Gerenciamento de projetos: uma fabricante lança uma nova linha de produtos dentro da janela comercial – escopo, prazo, orçamento, qualidade e riscos.") },
    erp: { mode: "project", name: L("ERP implementation", "Implantação de ERP"), desc: L("Project management: a distributor replaces its management system by go-live – data migration, customisations, key users and changes.", "Gerenciamento de projetos: uma distribuidora troca o sistema de gestão até o go-live – migração de dados, customizações, usuários-chave e mudanças.") },
    obra: { mode: "project", name: L("Construction / site expansion", "Obra / expansão de unidade"), desc: L("Project management: building a distribution centre – physical-financial schedule, permits, contractors, rain and material prices.", "Gerenciamento de projetos: construção de um centro de distribuição – cronograma físico-financeiro, licenças, empreiteiras, chuvas e preço de materiais.") },
    pmo: { mode: "project", name: L("Project portfolio (PMO)", "Portfólio de projetos (PMO)"), desc: L("Project management: the portfolio is bigger than the budget and the team – prioritise, cut scope and deliver value.", "Gerenciamento de projetos: o portfólio é maior que o orçamento e a equipe – priorizar, cortar escopo e entregar valor.") },
    industria: { mode: "business", name: L("Business management · Manufacturing", "Gestão empresarial · Indústria"), desc: L("Company and market: production, capacity, costs and investment; income statement, balance sheet and cash flow.", "Empresa e mercado: produção, capacidade, custos e investimento; DRE, balanço e fluxo de caixa.") },
    varejo: { mode: "business", name: L("Business management · Retail", "Gestão empresarial · Varejo"), desc: L("Company and market: price, stock and marketing in a competitive market.", "Empresa e mercado: preço, estoque e marketing num mercado competitivo.") },
    servicos: { mode: "business", name: L("Business management · Services", "Gestão empresarial · Serviços"), desc: L("Company and market: team capacity, quality and client satisfaction.", "Empresa e mercado: capacidade da equipe, qualidade e satisfação do cliente.") },
    startup: { mode: "business", name: L("Business management · Tech startup", "Gestão empresarial · Startup de tecnologia"), desc: L("Company and market: fast growth, R&D and funding decisions.", "Empresa e mercado: crescimento acelerado, P&D e decisões de financiamento.") }
  };
})();
