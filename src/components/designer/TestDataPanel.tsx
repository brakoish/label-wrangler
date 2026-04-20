'use client';

import { useState } from 'react';
import { FlaskConical, ChevronDown } from 'lucide-react';
import { TemplateElement } from '@/lib/types';

interface TestDataPanelProps {
  elements: TemplateElement[];
  testData: Record<string, string>;
  onTestDataChange: (fieldName: string, value: string) => void;
}

export function TestDataPanel({ elements, testData, onTestDataChange }: TestDataPanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Collect all unique dynamic field names
  const dynamicFields = elements
    .filter((e) => !e.isStatic && e.fieldName)
    .reduce((acc, e) => {
      if (e.fieldName && !acc.find((f) => f.fieldName === e.fieldName)) {
        acc.push({
          fieldName: e.fieldName,
          defaultValue: e.defaultValue || '',
          type: e.type,
          prefix: e.prefix || '',
          suffix: e.suffix || '',
        });
      }
      return acc;
    }, [] as { fieldName: string; defaultValue: string; type: string; prefix: string; suffix: string }[]);

  if (dynamicFields.length === 0) return null;

  return (
    <div className="border-t border-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-zinc-800/30 transition-all"
      >
        <FlaskConical className="w-4 h-4 text-amber-400" />
        <span className="text-zinc-300 font-medium flex-1 text-left">Test Data</span>
        <span className="text-[10px] text-zinc-500 mr-1">{dynamicFields.length} field{dynamicFields.length !== 1 ? 's' : ''}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {dynamicFields.map((field) => (
            <div key={field.fieldName}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{field.fieldName}</span>
                {(field.prefix || field.suffix) && (
                  <span className="text-[10px] text-zinc-600">
                    {field.prefix && `"${field.prefix}"`}
                    {field.prefix && field.suffix && ' · '}
                    {field.suffix && `"${field.suffix}"`}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={testData[field.fieldName] ?? ''}
                onChange={(e) => onTestDataChange(field.fieldName, e.target.value)}
                placeholder={field.defaultValue || `Enter ${field.fieldName}...`}
                className="w-full bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-xs text-zinc-100 px-2.5 h-7 focus:outline-none focus:border-amber-500/30 placeholder-zinc-600 transition-all"
              />
            </div>
          ))}

          {Object.values(testData).some((v) => v) && (
            <button
              onClick={() => dynamicFields.forEach((f) => onTestDataChange(f.fieldName, ''))}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear test data
            </button>
          )}
        </div>
      )}
    </div>
  );
}
