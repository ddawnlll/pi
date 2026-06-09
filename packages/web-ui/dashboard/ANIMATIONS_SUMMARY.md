# Dashboard Animations Summary

This document summarizes all animations added to the Pi dashboard UI in `packages/web-ui/dashboard/`.

## Overview

A comprehensive animation system has been implemented across the dashboard to enhance user experience with smooth transitions, micro-interactions, and visual feedback.

## Animation System Architecture

### 1. Central Animation CSS (`src/animations.css`)

Created a centralized animation library with reusable utilities including:

#### Page Transitions
- `fade-in-up`, `fade-in-down`, `fade-in-left`, `fade-in-right` - Directional fade animations
- `scale-in` - Scale entrance animation
- Stagger delays (`.stagger-1` through `.stagger-8`) for list items

#### Hover Effects
- `.hover-lift` - Lifts element with enhanced shadow on hover
- `.hover-glow` - Adds glowing border effect
- `.card-hover` - Combined lift + shadow for cards
- `.scale-hover` - Scales element up on hover
- `.opacity-hover` - Reduces opacity on hover
- `.icon-rotate-hover` - Rotates icons on hover
- `.link-hover` - Underline animation for links

#### Click/Tap Feedback
- `.tap-feedback` - Subtle scale down on click
- `.btn-press` - Button press effect (0.96x scale)
- `.ripple-effect` - Material-style ripple on buttons

#### Loading States
- `.skeleton` - Shimmer loading skeleton
- `.shimmer` - Gradient shimmer effect
- `.animate-progress-stripe` - Animated progress bar stripes

#### Special Effects
- `.pulse-subtle` - Gentle pulsing
- `.pulse-ring` - Expanding ring pulse
- `.bounce-subtle` - Gentle bounce
- `.shake` - Error shake animation
- `.border-glow` - Glowing border pulse
- `.badge-pulse` - Notification badge pulse
- `.typing-cursor` - Blinking cursor

#### Utility Classes
- `.transition-smooth` - Standard smooth transition (0.2s cubic-bezier)
- `.transition-fast` - Fast transition (0.15s)
- `.transition-slow` - Slow transition (0.3s)

### 2. Integration

Imported into main CSS via `src/index.css`:
```css
@import "./animations.css";
```

## Enhanced Components

### Core UI Components

#### 1. StatCard (`components/StatCard.tsx`)
- Added `card-hover` class for lift effect
- Icons rotate on hover with `icon-rotate-hover`
- Smooth transitions on all properties

#### 2. WorkspaceCardV3 (`components/workspaces/WorkspaceCardV3.tsx`)
- Card hover lift effect with `card-hover`
- Chevron arrow slides right on hover (`translate-x-1`)
- Enhanced transition timing

#### 3. WorkspaceCardActions (`components/workspaces/WorkspaceCardActions.tsx`)
- Stop button: scales on hover, press feedback
- Retry button: icon rotates on hover, press feedback
- All actions have `btn-press` and hover effects

#### 4. TaskCard (`components/TaskCard.tsx`)
- Full card hover with lift effect
- Chevron slides right on hover
- Smooth color transitions

#### 5. IconBtn & LabeledBtn (`components/IconBtn.tsx`)
- Both button variants have press feedback (`btn-press`)
- Smooth transitions maintained

#### 6. ProjectItem (`components/ProjectItem.tsx`)
- Button press feedback
- Chevron animates in when active (`animate-fade-in-right`)

### Brain Components

#### 7. MemoryCard (`components/brain/memory/MemoryCard.tsx`)
- Card hover lift effect
- Smooth border color transitions

#### 8. ProposalCard (`components/brain/proposals/ProposalCard.tsx`)
- Card container has hover lift
- Title link has underline animation (`link-hover`)
- Action buttons (Accept/Reject/Correct) have press feedback

#### 9. ReflectionCard (`components/brain/reflections/ReflectionCard.tsx`)
- Card hover with lift effect
- Smooth border transitions

#### 10. GoalCard (`components/brain/goals/GoalCard.tsx`)
- Card hover lift effect
- Progress bars animate smoothly (existing)

### Worker Components

#### 11. WorkerCard (`components/workers/WorkerCard.tsx`)
- Already had framer-motion layout animations
- Added `card-hover` for additional hover lift
- Action buttons enhanced with press feedback and icon rotation
- Retry button icon rotates on hover

## Existing Animation Infrastructure

Several components already had sophisticated animations that were preserved and enhanced:

### Framer Motion Components
- **AppShell** - Sidebar/drawer slide animations
- **CenterWorkSurface** - Tab content cross-fade with slide
- **Header** - Status badge color transitions
- **EventFeed** - Entry fade-in with AnimatePresence
- **SettingsDialog** - Modal animations
- **WorkerCard** - Layout animations with scale on hover/tap
- **ActivityDot** - Pulsing status indicator
- **ThinkingAnimation** - Comprehensive state-based animations including:
  - Dot animations for thinking states
  - Brain pulse, tool bounce, arrow cycle
  - Live text typing effect
  - Cursor blinking

### CSS Keyframe Animations (from app.css)
- Log fade-in animation
- Thinking dot sequences
- Spin slow for CPU icon

## Animation Guidelines

### When to Use Which Effect

**Cards**: Use `card-hover` for consistent elevation on hover
**Buttons**: Use `btn-press` for tactile feedback
**Icons**: Use `icon-rotate-hover` for affordance
**Links**: Use `link-hover` for subtle underline
**Lists**: Use stagger delays for sequential entrance
**Loading**: Use `skeleton` or `shimmer` for placeholders
**Status**: Use pulse animations for active states

### Performance Considerations

- All animations use CSS transforms and opacity (GPU-accelerated)
- Transitions are kept short (0.15s - 0.3s) for snappy feel
- Cubic-bezier easing provides natural motion
- No layout-triggering animations (avoid width/height changes)

### Accessibility

- Respects user preferences (animations are subtle)
- No infinite animations without pause capability
- Color changes maintain contrast ratios
- Interactive elements have clear visual feedback

## Future Enhancements

Potential areas for additional animations:
1. FileExplorer tree item expand/collapse
2. Data table row hover effects
3. Chart/graph entrance animations
4. Toast notification slide-ins
5. Modal/dialog zoom effects
6. Drag-and-drop visual feedback
7. Infinite scroll loading indicators
8. Search result highlighting

## Testing

To verify animations:
1. Run dashboard dev server
2. Navigate between pages to see tab transitions
3. Hover over cards, buttons, and interactive elements
4. Click buttons to see press feedback
5. Observe loading states and status indicators
6. Test both light and dark themes

## Maintenance

When adding new components:
1. Check if similar components exist and match their animation patterns
2. Use existing utility classes from `animations.css`
3. Prefer CSS transitions over JavaScript animations
4. Use framer-motion for complex sequence animations
5. Keep animations subtle and purposeful
