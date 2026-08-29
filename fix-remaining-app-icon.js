/**
 * Run when IDE has closed locked screen files:
 *   node backend/fix-remaining-app-icon.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const updates = [
  ['screens/Appointments.js', '../components/AppIcon'],
  ['screens/ProductDetails.js', '../components/AppIcon'],
  ['screens/ProfileScreen.js', '../components/AppIcon'],
  ['screens/QLessScreen.js', '../components/AppIcon'],
  ['screens/SurakshaReport.js', '../components/AppIcon'],
  ['screens/trading/NewsScreen.js', '../../components/AppIcon'],
  ['screens/components/UserHome/UserFeatureHub.js', '../../../components/AppIcon'],
  ['screens/UserHome.js', '../components/AppIcon', true],
  ['components/ThemeSwitcher.js', './AppIcon', false, true],
  ['components/PhonePeButton.js', './AppIcon'],
];

for (const entry of updates) {
  const [rel, importPath, isUserHome, jsxOnly] = entry;
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  if (jsxOnly) {
    text = text.replace(/<MaterialCommunityIcons/g, '<AppIcon');
  } else if (isUserHome) {
    text = text.replace(
      /import \{ MaterialCommunityIcons, Ionicons \} from '@expo\/vector-icons';/,
      `import { Ionicons } from '@expo/vector-icons';\nimport AppIcon from '${importPath}';`
    );
    text = text.replace(/<MaterialCommunityIcons/g, '<AppIcon');
  } else {
    text = text.replace(
      /import \{ MaterialCommunityIcons \} from ['"]@expo\/vector-icons['"];?\n?/,
      `import AppIcon from '${importPath}';\n`
    );
    text = text.replace(/<MaterialCommunityIcons/g, '<AppIcon');
  }
  fs.writeFileSync(file, text);
  console.log('updated', rel);
}
