const fs = require('fs');
const path = require('path');

const files = [
  {
    file: path.join(__dirname, '..', 'screens', 'TrustScoreDashboard.js'),
    focusedName: 'TrustScoreDashboard',
  },
  {
    file: path.join(__dirname, '..', 'screens', 'CyberDashboardEnhanced.js'),
    focusedName: 'CyberDashboard',
  },
  {
    file: path.join(__dirname, '..', 'screens', 'ProjectDetails.js'),
    focusedName: 'ProjectDetails',
  },
];

const importBlock = `import DashboardHeaderRight from '../components/DashboardHeaderRight';
import { HeaderIconButton } from '../components/HeaderIconButton';
`;

for (const { file, focusedName } of files) {
  if (!fs.existsSync(file)) {
    console.log('skip missing', file);
    continue;
  }
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  if (!s.includes('DashboardHeaderRight')) {
    s = s.replace(
      /import CollapsibleDashboardSection[^\n]*\n/,
      (m) => `${m}${importBlock}`
    );
    if (!s.includes('DashboardHeaderRight')) {
      s = s.replace(
        /(import[^\n]+from ['"][^'"]+['"];?\n)(?=const |function |export )/,
        `$1${importBlock}`
      );
    }
  }

  s = s.replace(
    /useLayoutEffect\(\(\) => \{[\s\S]*?headerRight: \(\) => \([\s\S]*?IconButton[\s\S]*?\)[\s\S]*?\}\);[\s\S]*?\}, \[[^\]]*\]\);/m,
    `useLayoutEffect(() => {
        if (!navigation?.setOptions) return;
        navigation.setOptions({
            headerRight: () => (
                <DashboardHeaderRight navigation={navigation} focusedName="${focusedName}">
                    {features.enable_pdf_reports ? (
                        <HeaderIconButton
                            title="Export PDF report"
                            icon="file-pdf-box"
                            onPress={handleExportReport}
                        />
                    ) : null}
                </DashboardHeaderRight>
            ),
        });
    }, [navigation, features.enable_pdf_reports, handleExportReport]);`
  );

  if (s !== before) {
    fs.writeFileSync(file, s);
    console.log('patched', path.basename(file));
  } else {
    console.log('no change', path.basename(file));
  }
}
