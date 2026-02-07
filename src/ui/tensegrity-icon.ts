/**
 * Tensegrity Chat Bubble Icon
 * Combines chat bubble with tensegrity structural elements
 */

export const TENSEGRITY_CHAT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Chat bubble outline -->
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>

  <!-- Tensegrity structure inside -->
  <!-- Top nodes -->
  <circle cx="9" cy="8" r="1" fill="currentColor"/>
  <circle cx="15" cy="8" r="1" fill="currentColor"/>

  <!-- Bottom node -->
  <circle cx="12" cy="14" r="1" fill="currentColor"/>

  <!-- Tension cables (thin lines) -->
  <line x1="9" y1="8" x2="15" y2="8" stroke-width="1" opacity="0.6"/>
  <line x1="9" y1="8" x2="12" y2="14" stroke-width="1" opacity="0.6"/>
  <line x1="15" y1="8" x2="12" y2="14" stroke-width="1" opacity="0.6"/>

  <!-- Compression struts (thicker lines) -->
  <line x1="9" y1="8" x2="12" y2="11" stroke-width="1.5"/>
  <line x1="15" y1="8" x2="12" y2="11" stroke-width="1.5"/>
</svg>
`;

export const TENSEGRITY_CHAT_ICON_MINIMAL = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Chat bubble with rounded corners -->
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>

  <!-- Simplified tensegrity - three nodes in triangle -->
  <circle cx="8" cy="9" r="1.2" fill="currentColor"/>
  <circle cx="16" cy="9" r="1.2" fill="currentColor"/>
  <circle cx="12" cy="13" r="1.2" fill="currentColor"/>

  <!-- Connecting lines -->
  <line x1="8" y1="9" x2="16" y2="9" stroke-width="1" opacity="0.5"/>
  <line x1="8" y1="9" x2="12" y2="13" stroke-width="1" opacity="0.5"/>
  <line x1="16" y1="9" x2="12" y2="13" stroke-width="1" opacity="0.5"/>
</svg>
`;

export const TENSEGRITY_CHAT_ICON_COMPACT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Chat bubble -->
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>

  <!-- Three interconnected nodes (reads as structure even at small size) -->
  <circle cx="9" cy="10" r="1" fill="currentColor"/>
  <circle cx="15" cy="10" r="1" fill="currentColor"/>
  <circle cx="12" cy="13" r="1" fill="currentColor"/>

  <!-- Simple tension lines -->
  <path d="M9 10 L15 10 M9 10 L12 13 M15 10 L12 13" stroke-width="0.8" opacity="0.4"/>
</svg>
`;
