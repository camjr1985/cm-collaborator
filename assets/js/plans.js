/* CM Collaborator – plans and limits (client-side checks; payments will set plans/<email-key> later). */
(function () {
  "use strict";
  window.CM_PLANS = {
    free:       { name: "Free",       priceUSD: 0,  workspaces: 1,   boards: 3,    seats: 2 },
    pro:        { name: "Pro",        priceUSD: 9,  workspaces: 10,  boards: 100,  seats: 5 },
    team:       { name: "Team",       priceUSD: 7,  workspaces: 50,  boards: 1000, seats: 3, perSeat: true },
    enterprise: { name: "Enterprise", priceUSD: null, workspaces: 999, boards: 99999, seats: 999 }
  };
  /* returns the effective plan for a plans/<key> record ({plan, seats, until}) */
  window.CMPlan = function (rec) {
    const P = window.CM_PLANS;
    let id = rec && rec.plan && P[rec.plan] ? rec.plan : "free";
    if (rec && rec.until && rec.until < Date.now()) id = "free";
    const base = P[id];
    return { id: id, name: base.name, workspaces: base.workspaces, boards: base.boards, seats: id !== "free" && rec && rec.seats ? Number(rec.seats) : base.seats, until: rec && rec.until || null };
  };
})();
