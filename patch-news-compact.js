const fs = require('fs');
const path = require('path');

function patchThumbnail() {
  const file = path.join(__dirname, '..', 'components', 'ThumbnailImage.js');
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('fallbackUri')) {
    console.log('ThumbnailImage already patched');
    return;
  }
  s = s.replace('  fullUri,\n  style,', '  fullUri,\n  fallbackUri,\n  style,');
  const oldBlock = [
    '  const [thumbError, setThumbError] = React.useState(false);',
    '  const [fullError, setFullError] = React.useState(false);',
    '  const [open, setOpen] = React.useState(false);',
    '',
    '  const thumbSource = thumbnailUri || makeThumbUri(uri);',
    '  const fullSource = fullUri || makeFullUri(uri);',
    '',
    '  if (!thumbSource || thumbError) {',
    '    return <View style={[style, fallbackStyle]} />;',
    '  }',
    '',
    '  const content = (',
    '    <Image',
    '      source={{ uri: thumbSource }}',
    '      style={style}',
    '      resizeMode={resizeMode}',
    '      onLoadStart={onLoadStart}',
    '      onError={(e) => {',
    '        setThumbError(true);',
    '        if (typeof onError === "function") onError(e);',
    '      }}',
    '    />',
    '  );',
  ].join('\n');
  const newBlock = [
    '  const [thumbError, setThumbError] = React.useState(false);',
    '  const [fallbackError, setFallbackError] = React.useState(false);',
    '  const [fullError, setFullError] = React.useState(false);',
    '  const [open, setOpen] = React.useState(false);',
    '',
    '  const thumbSource = thumbnailUri || makeThumbUri(uri);',
    '  const fullSource = fullUri || makeFullUri(uri);',
    '  const activeSource =',
    '    thumbError && fallbackUri && !fallbackError ? makeThumbUri(fallbackUri) : thumbSource;',
    '',
    '  if (!activeSource || (thumbError && (!fallbackUri || fallbackError))) {',
    "    return <View style={[style, fallbackStyle, { backgroundColor: '#e5e7eb' }]} />;",
    '  }',
    '',
    '  const content = (',
    '    <Image',
    '      source={{ uri: activeSource }}',
    '      style={style}',
    '      resizeMode={resizeMode}',
    '      onLoadStart={onLoadStart}',
    '      onError={(e) => {',
    '        if (!thumbError && fallbackUri) {',
    '          setThumbError(true);',
    '          return;',
    '        }',
    '        if (fallbackUri) setFallbackError(true);',
    '        else setThumbError(true);',
    '        if (typeof onError === "function") onError(e);',
    '      }}',
    '    />',
    '  );',
  ].join('\n');
  if (!s.includes(oldBlock)) {
    console.log('ThumbnailImage block not found');
    return;
  }
  s = s.replace(oldBlock, newBlock);
  fs.writeFileSync(file, s);
  console.log('ThumbnailImage patched');
}

function patchNewsScreen() {
  const file = path.join(__dirname, '..', 'screens', 'trading', 'NewsScreenGeo.js');
  let s = fs.readFileSync(file, 'utf8');

  if (!s.includes('getNewsCoverFallback')) {
    s = s.replace(
      'import { getNewsCategoryColor, getNewsCoverUrl, getNewsGradient, extractNewsImageUrl } from "../../utils/newsImages";',
      'import { getNewsCategoryColor, getNewsCoverUrl, getNewsCoverFallback, getNewsGradient, extractNewsImageUrl } from "../../utils/newsImages";'
    );
  }

  if (!s.includes('LOAD_MORE_STEP')) {
    s = s.replace('const PAGE_SIZE = 10;', 'const PAGE_SIZE = 5;\nconst LOAD_MORE_STEP = 5;');
    s = s.replace(/setVisibleCount\(\(c\) => c \+ PAGE_SIZE\)/g, 'setVisibleCount((c) => c + LOAD_MORE_STEP)');
  }

  if (!s.includes('windowWidth >= 1100')) {
    s = s.replace(
      '    if (windowWidth >= 900) return 4;',
      '    if (windowWidth >= 1100) return 5;\n    if (windowWidth >= 860) return 4;'
    );
  }

  if (!s.includes('fallbackUri={getNewsCoverFallback')) {
    s = s.replace(
      '            enableFull\n          />',
      '            fallbackUri={getNewsCoverFallback(item)}\n            enableFull={false}\n          />'
    );
  }

  s = s.replace('numberOfLines={3}', 'numberOfLines={2}');

  if (s.includes('height: 180,')) {
    s = s.replace('height: 180,', 'height: 140,');
    s = s.replace('height: 130,', 'height: 96,');
  }

  s = s.replace(
    'Showing {newsSlice.visible.length} of {filteredItems.length}. Scroll down to load more.',
    'Showing {newsSlice.visible.length} of {filteredItems.length} in this category.'
  );

  if (s.includes('onEndReached={handleEndReached}')) {
    const footerOld = [
      '        onEndReached={handleEndReached}',
      '        onEndReachedThreshold={0.35}',
      '        ListFooterComponent={',
      '          loadingMore ? (',
      '            <View style={styles.loadMoreFooter}>',
      '              <ActivityIndicator size="small" color={fb.blue} />',
      '              <Text style={styles.loadMoreHint}>Loading more stories…</Text>',
      '            </View>',
      '          ) : newsSlice.hasMore ? (',
      '            <View style={styles.loadMoreFooter}>',
      '              <Text style={styles.loadMoreHint}>',
      '                {newsSlice.total - newsSlice.visible.length} more — keep scrolling',
      '              </Text>',
      '            </View>',
      '          ) : null',
      '        }',
    ].join('\n');
    const footerNew = [
      '        ListFooterComponent={',
      '          feedExpanded && newsSlice.visible.length > 0 && newsSlice.hasMore ? (',
      '            <View style={styles.loadMoreFooter}>',
      '              <LoadMoreButton',
      '                label={`Show ${Math.min(LOAD_MORE_STEP, Math.max(0, filteredItems.length - newsSlice.visible.length))} more`}',
      '                onPress={handleLoadMore}',
      '                loading={loadingMore}',
      '              />',
      '            </View>',
      '          ) : null',
      '        }',
    ].join('\n');
    s = s.replace(footerOld, footerNew);
  }

  fs.writeFileSync(file, s);
  console.log('NewsScreenGeo patched');
}

patchThumbnail();
patchNewsScreen();
