/**
 * RERAScore-style project validation — financial reserve, breakdown scores, user alerts.
 * MahaRERA rule: ≥70% of collections must be in escrow/separate account before/during construction.
 */

function parseAmountToCrores(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).replace(/,/g, '').toLowerCase();
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  if (Number.isNaN(num)) return null;
  if (s.includes('lakh')) return num / 100;
  if (s.includes('crore') || s.includes('cr')) return num;
  if (num > 10000000) return num / 10000000;
  if (num > 100000) return num / 100;
  return num;
}

function scoreColor(ratio) {
  if (ratio >= 0.85) return '#2e7d32';
  if (ratio >= 0.55) return '#f57c00';
  return '#c62828';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {object} project - trust score project row
 * @param {object} [reraGovt] - optional govt/RERA API overlay
 */
function buildProjectValidation(project = {}, reraGovt = {}) {
  const complaintCount =
    project.reraComplaintsCount ??
    project.rera_complaints_count ??
    reraGovt.reraComplaintsCount ??
    0;
  const p = {
    ...project,
    ...reraGovt,
    reraComplaintsCount: complaintCount,
    reraComplaintsStatus:
      project.reraComplaintsStatus ??
      project.rera_complaints_status ??
      reraGovt.reraComplaintsStatus,
  };
  const collected = parseAmountToCrores(p.totalAmountCollected);
  const loan = parseAmountToCrores(p.loanAmountSanctioned);
  const deposited = parseAmountToCrores(
    p.escrowReserveDeposited || p.amountReserved || p.escrowAmount
  );
  const estimatedCost = parseAmountToCrores(p.estimatedProjectCost || p.projectCost);
  const requiredReservePct = Number(p.escrowReservePercentRequired || 70);
  const requiredReserve =
    collected != null ? (collected * requiredReservePct) / 100 : null;

  let depositedFinal = deposited;
  if (depositedFinal == null && collected != null && p.escrowCompliant !== false) {
    depositedFinal = requiredReserve;
  }

  const reserveRatio =
    requiredReserve && depositedFinal != null
      ? depositedFinal / requiredReserve
      : null;

  const completion = Number(p.completion || 0);
  const deliveryScore = clamp(Math.round((completion / 100) * 30), 0, 30);

  const docsFiled = Number(p.documentsFiled || p.documentsCount || 0);
  const documentsScore =
    docsFiled >= 10 ? 20 : docsFiled >= 5 ? 15 : docsFiled >= 1 ? 10 : 0;

  const complaints = Number(p.reraComplaintsCount || 0);
  const legalScore = clamp(20 - complaints * 4, 0, 20);

  let financialScore = 5;
  if (reserveRatio != null) {
    if (reserveRatio >= 1) financialScore = 10;
    else if (reserveRatio >= 0.7) financialScore = 8;
    else if (reserveRatio >= 0.5) financialScore = 5;
    else financialScore = 2;
  } else if (loan != null && collected != null) {
    financialScore = collected >= loan * 0.3 ? 7 : 4;
  }

  const hasRera = !!(p.reraNumber || p.rera_number);
  const status = String(p.projectStatus || p.status || '').toLowerCase();
  const registrationScore = hasRera ? (status.includes('revok') ? 2 : 8) : 0;

  const agents = Number(p.registeredAgents || p.agentCount || 0);
  const agentScore = clamp(Math.min(agents * 2, 10), 0, 10);

  const breakdown = [
    { key: 'delivery', label: 'Delivery', score: deliveryScore, max: 30 },
    { key: 'documents', label: 'Documents', score: documentsScore, max: 20 },
    { key: 'legal', label: 'Legal Risk', score: legalScore, max: 20 },
    { key: 'financial', label: 'Financial', score: financialScore, max: 10 },
    { key: 'registration', label: 'Registration', score: registrationScore, max: 10 },
    { key: 'agents', label: 'Agent Network', score: agentScore, max: 10 },
  ];

  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
  const maxTotal = breakdown.reduce((s, b) => s + b.max, 0);

  const alerts = [];
  if (reserveRatio != null && reserveRatio < 0.7) {
    alerts.push({
      severity: 'high',
      title: 'Low escrow reserve',
      message: `Only ${Math.round(reserveRatio * 100)}% of required 70% escrow deposited. Funds may be at risk if builder defaults.`,
    });
  }
  if (complaints > 0) {
    alerts.push({
      severity: complaints >= 2 ? 'high' : 'medium',
      title: 'RERA complaints registered',
      message: `${complaints} complaint(s) on MahaRERA. Review before investing.`,
    });
  }
  if (completion < 30 && collected != null && collected > 100) {
    alerts.push({
      severity: 'medium',
      title: 'Early-stage collections',
      message: 'Large collections at low completion — verify escrow deposits on govt portal.',
    });
  }
  if (!hasRera) {
    alerts.push({
      severity: 'high',
      title: 'Missing RERA number',
      message: 'Project RERA registration not verified.',
    });
  }

  const formatCrores = (n) =>
    n == null ? 'N/A' : `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;

  return {
    totalScore,
    maxTotal,
    breakdown,
    financialReserve: {
      totalCollected: p.totalAmountCollected || 'N/A',
      totalCollectedCr: collected,
      loanSanctioned: p.loanAmountSanctioned || 'N/A',
      loanSanctionedCr: loan,
      estimatedProjectCost: p.estimatedProjectCost || estimatedCost
        ? formatCrores(estimatedCost)
        : 'N/A',
      escrowRequired: requiredReserve != null ? formatCrores(requiredReserve) : 'N/A',
      escrowRequiredCr: requiredReserve,
      escrowDeposited: depositedFinal != null ? formatCrores(depositedFinal) : 'N/A',
      escrowDepositedCr: depositedFinal,
      escrowPercentRequired: requiredReservePct,
      escrowCompliancePercent:
        reserveRatio != null ? Math.round(reserveRatio * 100) : null,
      bankName: p.bankName || 'N/A',
      fundingSources: p.fundingSources || 'N/A',
      reraRule: 'MahaRERA: min 70% of amounts received must be in a separate escrow account.',
    },
    atAGlance: {
      reraNumber: p.reraNumber || p.rera_number || 'N/A',
      totalComplaints: complaints,
      documentsFiled: docsFiled,
      projectStatus: p.projectStatus || p.status || 'N/A',
      bankName: p.bankName || 'N/A',
    },
    alerts,
    govSearchUrl: p.reraNumber
      ? `https://maharera.maharashtra.gov.in/projects-search-result?certificate_no=${encodeURIComponent(
          String(p.reraNumber).trim().toUpperCase()
        )}&project_state=27`
      : null,
  };
}

module.exports = { buildProjectValidation, parseAmountToCrores };
