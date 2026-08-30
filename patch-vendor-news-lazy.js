const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'screens', 'VendorDashboard.js');
let s = fs.readFileSync(file, 'utf8');

s = s.replace(
  `  const [vendorNews, setVendorNews] = useState([]);\n  const [loadingVendorNews, setLoadingVendorNews] = useState(false);\n`,
  ''
);

s = s.replace(
  `  useEffect(() => {\n    if (hasNewsAccess(user, features)) {\n      loadVendorNews();\n    }\n  }, [features.enable_news, user]);\n\n`,
  ''
);

s = s.replace(
  /  const loadVendorNews = async \(\) => \{[\s\S]*?  \};\n\n  const handleShareNews = async \(item\) => \{[\s\S]*?  \};\n\n/,
  ''
);

fs.writeFileSync(file, s);
console.log('Removed eager vendor news load from VendorDashboard.js');
