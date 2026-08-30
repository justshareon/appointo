const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'screens', 'SurakshaHome.js');
let s = fs.readFileSync(file, 'utf8');

if (!s.includes('casesLoaded')) {
  console.error('casesLoaded state missing — run prior SurakshaHome edits first');
  process.exit(1);
}

s = s.replace(
  `        const timer = setTimeout(() => loadReportedCases(false), 32);
        return () => clearTimeout(timer);`,
  `        setLoadingCases(false);
        return undefined;`
);

if (!s.includes('casesExpanded, casesLoaded, user?.id')) {
  s = s.replace(
    `    }, [onCheckPage, checkType, user?.id]);

    const onCasesRefresh`,
    `    }, [onCheckPage, checkType, user?.id]);

    useEffect(() => {
        if (onCheckPage || !casesExpanded || casesLoaded) return;
        loadReportedCases(false);
    }, [onCheckPage, casesExpanded, casesLoaded, user?.id]);

    const onCasesRefresh`
  );
}

s = s.replace(
  `        enabled: !onCheckPage && !!user?.id,
        deps: [onCheckPage, user?.id],`,
  `        enabled: !onCheckPage && !!user?.id && casesExpanded,
        deps: [onCheckPage, user?.id, casesExpanded],`
);

s = s.replace(
  `                            : loadingCases ? 'Loading…' : \`\${reportedCases.length} cases\`}
                        expanded={casesExpanded}
                        onToggle={() => setCasesExpanded((e) => !e)}`,
  `                            : !casesLoaded
                                ? 'Expand to load cases'
                                : loadingCases ? 'Loading…' : \`\${reportedCases.length} cases\`}
                        expanded={casesExpanded}
                        onToggle={handleCasesToggle}`
);

fs.writeFileSync(file, s);
console.log('Patched SurakshaHome lazy cases');
