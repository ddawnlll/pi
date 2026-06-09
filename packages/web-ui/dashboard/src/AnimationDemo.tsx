/**
 * Animation Demo Component
 * 
 * This component demonstrates all available animation classes and effects
 * for reference during development.
 * 
 * Usage: Import and render in a test page to preview animations.
 */

import React from 'react';

export function AnimationDemo() {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Dashboard Animation System</h1>

      {/* Page Transitions */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Page Transitions</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="animate-fade-in-up p-4 bg-blue-50 rounded">Fade In Up</div>
          <div className="animate-fade-in-down p-4 bg-green-50 rounded">Fade In Down</div>
          <div className="animate-fade-in-left p-4 bg-purple-50 rounded">Fade In Left</div>
          <div className="animate-fade-in-right p-4 bg-orange-50 rounded">Fade In Right</div>
          <div className="animate-scale-in p-4 bg-pink-50 rounded">Scale In</div>
          <div className="animate-zoom-in p-4 bg-yellow-50 rounded">Zoom In</div>
        </div>
      </section>

      {/* Staggered List */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Staggered List Items</h2>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`animate-fade-in-up stagger-${i} p-3 bg-stone-50 rounded`}>
              Item {i} (delay: {(i * 0.05).toFixed(2)}s)
            </div>
          ))}
        </div>
      </section>

      {/* Hover Effects */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Hover Effects (hover over these)</h2>
        <div className="grid grid-cols-3 gap-4">
          <button className="hover-lift p-4 bg-white border rounded shadow-sm">
            Hover Lift
          </button>
          <button className="hover-glow p-4 bg-white border rounded">
            Hover Glow
          </button>
          <button className="card-hover p-4 bg-white border rounded shadow-sm">
            Card Hover
          </button>
          <button className="scale-hover p-4 bg-white border rounded">
            Scale Hover
          </button>
          <button className="opacity-hover p-4 bg-white border rounded">
            Opacity Hover
          </button>
          <button className="icon-rotate-hover p-4 bg-white border rounded flex items-center gap-2">
            <span>🔄</span> Icon Rotate
          </button>
        </div>
      </section>

      {/* Click Feedback */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Click/Tap Feedback (click these)</h2>
        <div className="flex gap-4">
          <button className="tap-feedback px-4 py-2 bg-blue-500 text-white rounded">
            Tap Feedback
          </button>
          <button className="btn-press px-4 py-2 bg-green-500 text-white rounded">
            Button Press
          </button>
          <button className="ripple-effect px-4 py-2 bg-purple-500 text-white rounded overflow-hidden">
            Ripple Effect
          </button>
        </div>
      </section>

      {/* Loading States */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Loading States</h2>
        <div className="space-y-3">
          <div className="skeleton h-4 w-full rounded"></div>
          <div className="skeleton h-4 w-3/4 rounded"></div>
          <div className="skeleton h-4 w-1/2 rounded"></div>
          
          <div className="shimmer p-4 bg-gradient-to-r from-stone-100 to-stone-200 rounded">
            Shimmer Effect
          </div>
          
          <div className="h-4 bg-blue-500 rounded animate-progress-stripe"></div>
        </div>
      </section>

      {/* Pulse Animations */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Pulse Animations</h2>
        <div className="flex gap-4 items-center">
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse-subtle"></div>
          <div className="relative w-4 h-4">
            <div className="absolute inset-0 bg-green-500 rounded-full animate-pulse-ring"></div>
            <div className="absolute inset-0 bg-green-500 rounded-full"></div>
          </div>
          <div className="w-4 h-4 bg-purple-500 rounded-full animate-bounce-subtle"></div>
          <div className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium animate-badge-pulse">
            Badge
          </div>
        </div>
      </section>

      {/* Special Effects */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Special Effects</h2>
        <div className="space-y-3">
          <div className="animate-shake p-4 bg-red-50 border border-red-200 rounded">
            Shake (Error State)
          </div>
          
          <div className="animate-border-glow p-4 border-2 border-blue-500 rounded">
            Border Glow
          </div>
          
          <div className="animate-typing-cursor inline-block">
            Typing Cursor
          </div>
          
          <div className="link-hover inline-block text-blue-600 cursor-pointer">
            Link Hover (underline animation)
          </div>
        </div>
      </section>

      {/* Transition Utilities */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Transition Utilities</h2>
        <p className="text-sm text-stone-600 mb-2">
          These are applied on state changes (hover, click, etc.)
        </p>
        <div className="flex gap-4">
          <button className="transition-smooth px-4 py-2 bg-white border rounded hover:bg-stone-50">
            Smooth (0.2s)
          </button>
          <button className="transition-fast px-4 py-2 bg-white border rounded hover:bg-stone-50">
            Fast (0.15s)
          </button>
          <button className="transition-slow px-4 py-2 bg-white border rounded hover:bg-stone-50">
            Slow (0.3s)
          </button>
        </div>
      </section>

      {/* Slide Animations */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Slide Animations</h2>
        <div className="space-y-2">
          <div className="animate-slide-in-right p-3 bg-blue-50 rounded">Slide In Right</div>
          <div className="animate-slide-in-left p-3 bg-green-50 rounded">Slide In Left</div>
          <div className="animate-slide-in-bottom p-3 bg-purple-50 rounded">Slide In Bottom</div>
        </div>
      </section>

      {/* Fade Out & Zoom Out */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Exit Animations</h2>
        <div className="flex gap-4">
          <div className="animate-fade-out p-3 bg-red-50 rounded opacity-50">Fade Out</div>
          <div className="animate-zoom-out p-3 bg-orange-50 rounded scale-90 opacity-50">Zoom Out</div>
        </div>
      </section>
    </div>
  );
}
