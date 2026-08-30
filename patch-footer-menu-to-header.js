const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'AppBottomFooter.js');
let src = fs.readFileSync(file, 'utf8');

// Remove all footer "More" tab entries
src = src.replace(/\s*\{ id: 'more', label: 'More', icon: 'dots-horizontal', more: true \},?\n/g, '\n');
src = src.replace(/\s*tabs\.push\(\{ id: 'more', label: 'More', icon: 'dots-horizontal', more: true \}\);\n/g, '\n');

// Remove footer menu state
src = src.replace(/\s*const \[moreOpen, setMoreOpen\] = useState\(false\);\n\s*const \[footerMenuKey, setFooterMenuKey\] = useState\(0\);\n/, '\n');

// Simplify isActive - remove more check
src = src.replace(/\s*if \(item\.more\) return false;\n/, '\n');

// Simplify go - remove more branch
src = src.replace(
  /const go = \(item\) => \{\s*if \(item\.more\) \{\s*setMoreOpen\(true\);\s*return;\s*\}\s*if \(item\.route\) onNavigate\(item\.route, item\.params\);\s*\};/,
  "const go = (item) => {\n    if (item.route) onNavigate(item.route, item.params);\n  };"
);

// Simplify footer item map - remove Menu wrapper for more
const oldMap = `{items.map((item) => {
        const active = isActive(item);
        const button = (
          <FooterTabButton
            key={item.id}
            label={item.label}
            icon={item.icon}
            active={active}
            onPress={() => go(item)}
          />
        );
        if (!item.more) return button;
        const overflowGroups = buildHeaderMenuGroups({
          user,
          features,
          healthPredictOn,
          isSuperUser,
          primaryRoute,
          primaryParams,
        });
        const closeFooterMenu = () => {
          setMoreOpen(false);
          setFooterMenuKey((k) => k + 1);
        };
        return (
          <Menu
            key={item.id}
            visible={moreOpen}
            onDismiss={closeFooterMenu}
            anchor={button}
          >
            <ExpandableMenuGroups
              key={footerMenuKey}
              groups={overflowGroups}
              onNavigate={(route, params) => {
                closeFooterMenu();
                onNavigate(route, params);
              }}
              onClose={closeFooterMenu}
              onLogout={() => {
                closeFooterMenu();
                onLogout?.();
              }}
            />
          </Menu>
        );
      })}`;

const newMap = `{items.map((item) => (
        <FooterTabButton
          key={item.id}
          label={item.label}
          icon={item.icon}
          active={isActive(item)}
          onPress={() => go(item)}
        />
      ))}`;

if (src.includes(oldMap)) {
  src = src.replace(oldMap, newMap);
} else {
  console.warn('Footer map block not found — may already be patched');
}

fs.writeFileSync(file, src, 'utf8');
console.log('Patched AppBottomFooter — removed footer More menu');
