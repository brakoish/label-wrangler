'use client';

import { useState } from 'react';
import { Plus, FileText, Trash2 } from 'lucide-react';
import { LabelTemplate } from '@/lib/types';
import { useFormatStore } from '@/lib/store';

interface TemplateListProps {
  templates: LabelTemplate[];
  onSelectTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onNewTemplate: () => void;
}

export function TemplateList({
  templates,
  onSelectTemplate,
  onDeleteTemplate,
  onNewTemplate,
}: TemplateListProps) {
  const { formats } = useFormatStore();

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold gradient-text">Label Templates</h2>
        <button
          onClick={onNewTemplate}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-medium hover:from-amber-700 hover:to-orange-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <FileText className="w-16 h-16 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-zinc-300 mb-2">No templates yet</h3>
          <p className="text-zinc-500 mb-6">Create your first label template to get started</p>
          <button
            onClick={onNewTemplate}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-medium hover:from-amber-700 hover:to-orange-700 transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Create Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => {
            const format = formats.find((f) => f.id === template.formatId);
            return (
              <TemplateCard
                key={template.id}
                template={template}
                formatName={format?.name || 'Unknown Format'}
                onSelect={() => onSelectTemplate(template.id)}
                onDelete={() => onDeleteTemplate(template.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  formatName,
  onSelect,
  onDelete,
}: {
  template: LabelTemplate;
  formatName: string;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className="glass rounded-xl p-5 card-hover border border-zinc-800 hover:border-amber-600/50 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-zinc-100 mb-1 truncate group-hover:text-amber-500 transition-colors">
            {template.name}
          </h3>
          <p className="text-xs text-zinc-500">{formatName}</p>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete template "${template.name}"?`)) {
              onDelete();
            }
          }}
          className="p-1.5 rounded-lg hover:bg-red-600/20 text-zinc-500 hover:text-red-400 transition-colors"
          title="Delete template"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {template.description && (
        <p className="text-sm text-zinc-400 mb-3 line-clamp-2">{template.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{template.elements.length} element{template.elements.length !== 1 ? 's' : ''}</span>
        <span>{new Date(template.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

interface NewTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, formatId: string) => void;
}

export function NewTemplateDialog({ isOpen, onClose, onCreate }: NewTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formatId, setFormatId] = useState('');
  const { formats } = useFormatStore();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !formatId) return;
    onCreate(name, description, formatId);
    setName('');
    setDescription('');
    setFormatId('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass rounded-2xl p-6 max-w-md w-full border border-zinc-800">
        <h3 className="text-xl font-semibold text-zinc-100 mb-6 gradient-text">New Template</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-2">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Product Label"
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50"
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this template..."
              rows={3}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 px-3 py-2.5 focus:outline-none focus:border-amber-500/50 resize-none"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 block mb-2">Label Format</label>
            <select
              value={formatId}
              onChange={(e) => setFormatId(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl text-sm text-zinc-100 px-3 py-2.5 focus:outline-none focus:border-amber-500/50"
            >
              <option value="">Select a format...</option>
              {formats.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name} ({format.width}" × {format.height}")
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !formatId}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-medium hover:from-amber-700 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
