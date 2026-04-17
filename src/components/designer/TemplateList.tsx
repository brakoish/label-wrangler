'use client';

import { useState } from 'react';
import { Plus, FileText, Trash2 } from 'lucide-react';
import { LabelTemplate } from '@/lib/types';
import { useFormatStore } from '@/lib/store';
import { CustomSelect } from '@/components/ui/CustomSelect';

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
    <div className="max-w-[1600px] mx-auto w-full p-8">
      {templates.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-800">
              <FileText className="w-10 h-10 text-zinc-600" />
            </div>
            <h3 className="text-zinc-300 font-semibold text-lg">No templates yet</h3>
            <p className="text-zinc-500 text-sm mt-2">
              Create your first label template to start designing
            </p>
            <button
              onClick={onNewTemplate}
              className="mt-4 text-amber-400 hover:text-amber-300 text-sm font-medium"
            >
              Create your first template
            </button>
          </div>
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
                formatType={format?.type || 'sheet'}
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
  formatType,
  onSelect,
  onDelete,
}: {
  template: LabelTemplate;
  formatName: string;
  formatType: string;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const dynamicCount = template.elements.filter((e) => !e.isStatic).length;

  return (
    <div
      onClick={onSelect}
      className="glass rounded-xl p-5 card-hover border border-zinc-800 hover:border-amber-500/30 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-zinc-100 mb-1 truncate group-hover:text-amber-400 transition-colors">
            {template.name}
          </h3>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              formatType === 'thermal'
                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
            }`}>
              {formatName}
            </span>
          </div>
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
        <span>
          {template.elements.length} element{template.elements.length !== 1 ? 's' : ''}
          {dynamicCount > 0 && (
            <span className="text-amber-500/70 ml-1">({dynamicCount} dynamic)</span>
          )}
        </span>
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
            {formats.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">
                No formats yet — <a href="/" className="text-amber-400 hover:text-amber-300">create a format</a> first
              </p>
            ) : (
              <CustomSelect
                value={formatId}
                onChange={setFormatId}
                placeholder="Select a format..."
                options={formats.map((format) => ({
                  value: format.id,
                  label: format.name,
                  sublabel: `${format.width}" × ${format.height}" — ${format.type}`,
                }))}
              />
            )}
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
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-semibold hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
