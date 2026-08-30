const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function patchNewsContext() {
  const p = path.join(root, 'contexts', 'NewsContext.js');
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('useRef')) {
    s = s.replace(
      "import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';",
      "import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';"
    );
  }
  if (!s.includes('feedFingerprint')) {
    s = s.replace(
      'import { hasNewsAccess }',
      'import { fingerprintNewsPayload, payloadChanged } from "../utils/feedFingerprint";\nimport { hasNewsAccess }'
    );
  }
  if (!s.includes('lastFpRef')) {
    s = s.replace(
      'const [limit, setLimit] = useState(50);',
      'const [limit, setLimit] = useState(50);\n    const lastFpRef = useRef("");\n    const fetchInflightRef = useRef(false);\n    const mountedAtRef = useRef(Date.now());'
    );
  }
  if (!s.includes('mountedAtRef.current < 2000')) {
    s = s.replace(
      'onSoft: () => fetchNews(limit, false),',
      'onSoft: () => { if (Date.now() - mountedAtRef.current < 2000) return; fetchNews(limit, false); },'
    );
  }
  fs.writeFileSync(p, s);
  console.log('NewsContext OK');
}

function patchFleetDashboard() {
  const p = path.join(root, 'screens', 'fleet', 'FleetDashboardView.js');
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/\s*dataLoadedRef\.current = false;\s*\n\s*socket/g, '\n        socket');
  if (!s.includes('useIsMounted')) {
    s = s.replace(
      "import { useFocusEffect } from '@react-navigation/native';",
      "import { useFocusEffect } from '@react-navigation/native';\nimport { useIsMounted } from '../../hooks/useIsMounted';"
    );
  }
  if (!s.includes('const isMounted = useIsMounted')) {
    s = s.replace(
      'const dataLoadedRef = useRef(false);',
      'const dataLoadedRef = useRef(false);\n  const isMounted = useIsMounted();'
    );
  }
  s = s.replace(
    `    onSoft: () => {
      if (!dataLoadedRef.current) loadDashboardData();
      else loadDashboardData();
    },`,
    `    onSoft: () => {
      if (!dataLoadedRef.current) loadDashboardData();
    },`
  );
  if (!s.includes('if (!isMounted()) return')) {
    s = s.replace(
      '    } finally {\n      setRefreshing(false);\n      loadingRef.current = false;\n      dataLoadedRef.current = true;\n    }',
      '    } finally {\n      if (isMounted()) {\n        setRefreshing(false);\n        dataLoadedRef.current = true;\n      }\n      loadingRef.current = false;\n    }'
    );
  }
  fs.writeFileSync(p, s);
  console.log('FleetDashboard OK');
}

function patchOfferScreen(file) {
  const p = path.join(root, 'screens', file);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('fingerprint: fingerprintOfferPayload')) {
    s = s.replace(
      'backgroundRefresh: !forceRefresh,',
      'backgroundRefresh: !forceRefresh,\n        fingerprint: (data) => fingerprintOfferPayload(data?.raw || data),'
    );
  }
  fs.writeFileSync(p, s);
  console.log(file, 'OK');
}

patchNewsContext();
patchFleetDashboard();
patchOfferScreen('OfferScreen.js');
patchOfferScreen('OfferScreenGeo.js');
