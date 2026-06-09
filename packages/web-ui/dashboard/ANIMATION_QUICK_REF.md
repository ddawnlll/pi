# Animation Quick Reference Guide

## How to Add Animations to Components

### 1. Card Hover Effects

```tsx
// Before
<div className="border rounded p-4">

// After
<div className="border rounded p-4 card-hover transition-smooth">
```

### 2. Button Press Feedback

```tsx
// Before
<button className="px-4 py-2 bg-blue-500 text-white rounded">

// After
<button className="px-4 py-2 bg-blue-500 text-white rounded btn-press">
```

### 3. Icon Hover Rotation

```tsx
// Before
<RefreshCw size={16} />

// After
<RefreshCw size={16} className="icon-rotate-hover" />
```

### 4. Link Underline Animation

```tsx
// Before
<a className="text-blue-600 hover:text-blue-700">

// After
<a className="text-blue-600 hover:text-blue-700 link-hover">
```

### 5. Page/Section Entrance

```tsx
// For entire sections
<div className="animate-fade-in-up">

// For list items with stagger
{items.map((item, i) => (
  <div key={item.id} className={`animate-fade-in-up stagger-${i + 1}`}>
))}
```

### 6. Loading States

```tsx
// Skeleton loading
<div className="skeleton h-4 w-full rounded"></div>

// Shimmer effect
<div className="shimmer p-4 bg-gradient-to-r from-stone-100 to-stone-200">
```

### 7. Status Indicators

```tsx
// Pulse for active states
<div className="w-2 h-2 bg-green-500 rounded-full animate-pulse-subtle"></div>

// Badge pulse
<span className="animate-badge-pulse">New</span>
```

## Available Animation Classes

### Transitions
- `transition-smooth` - Standard smooth transition
- `transition-fast` - Fast transition (0.15s)
- `transition-slow` - Slow transition (0.3s)

### Hover Effects
- `card-hover` - Lift card with shadow on hover
- `hover-lift` - Simple lift effect
- `hover-glow` - Glowing border
- `scale-hover` - Scale up on hover
- `opacity-hover` - Fade on hover
- `icon-rotate-hover` - Rotate icon on hover
- `link-hover` - Underline animation

### Click/Tap
- `btn-press` - Button press feedback
- `tap-feedback` - General tap feedback
- `ripple-effect` - Material ripple

### Entrances
- `animate-fade-in-up` - Fade in from below
- `animate-fade-in-down` - Fade in from above
- `animate-fade-in-left` - Fade in from left
- `animate-fade-in-right` - Fade in from right
- `animate-scale-in` - Scale in entrance
- `animate-zoom-in` - Zoom in entrance
- `animate-slide-in-right` - Slide from right
- `animate-slide-in-left` - Slide from left
- `animate-slide-in-bottom` - Slide from bottom

### Exits
- `animate-fade-out` - Fade out
- `animate-zoom-out` - Zoom out exit

### Loading
- `skeleton` - Shimmer skeleton loader
- `shimmer` - Gradient shimmer
- `animate-progress-stripe` - Progress bar stripes

### Status/Pulse
- `animate-pulse-subtle` - Gentle pulse
- `animate-pulse-ring` - Expanding ring
- `animate-bounce-subtle` - Gentle bounce
- `animate-badge-pulse` - Badge notification pulse
- `animate-border-glow` - Glowing border

### Special
- `animate-shake` - Error shake
- `animate-typing-cursor` - Blinking cursor
- `stagger-1` through `stagger-8` - Stagger delays

## Best Practices

1. **Performance**: All animations use CSS transforms and opacity (GPU-accelerated)
2. **Subtlety**: Keep animations subtle - users shouldn't be distracted
3. **Consistency**: Use the same animation patterns across similar components
4. **Accessibility**: Avoid infinite animations without pause capability
5. **Timing**: Use standard durations (0.15s - 0.3s) unless there's a specific reason

## Common Patterns

### Card Component
```tsx
<div className="border rounded p-4 card-hover transition-smooth">
  <Icon className="icon-rotate-hover" />
  <button className="btn-press">Action</button>
</div>
```

### List Items
```tsx
{items.map((item, i) => (
  <div 
    key={item.id}
    className="animate-fade-in-up"
    style={{ animationDelay: `${i * 0.05}s` }}
  >
    {item.content}
  </div>
))}
```

### Interactive Elements
```tsx
<button className="px-4 py-2 bg-blue-500 text-white rounded btn-press hover:bg-blue-600 transition-colors">
  Click Me
</button>
```

## When to Use Framer Motion vs CSS

**Use CSS animations when:**
- Simple hover effects
- Basic transitions
- Loading states
- Single-property animations

**Use Framer Motion when:**
- Complex sequences
- Layout animations
- AnimatePresence (mount/unmount)
- Gesture-based animations (drag, etc.)
- Spring physics needed

## Examples in Codebase

See these files for real-world examples:
- `components/StatCard.tsx` - Card hover + icon rotation
- `components/workspaces/WorkspaceCardV3.tsx` - Card hover + chevron slide
- `components/workers/WorkerCard.tsx` - Framer motion layout + CSS hover
- `components/IconBtn.tsx` - Button press feedback
- `components/brain/proposals/ProposalCard.tsx` - Multiple button types
- `components/shell/AppShell.tsx` - Sidebar/drawer transitions
- `routes/CenterWorkSurface.tsx` - Tab content transitions
