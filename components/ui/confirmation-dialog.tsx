'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
  requireTextConfirmation?: boolean;
  confirmationText?: string;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  requireTextConfirmation = false,
  confirmationText = 'delete',
}: ConfirmationDialogProps) {
  const [inputText, setInputText] = useState('');
  const isDestructive = variant === 'destructive';

  const handleConfirm = () => {
    if (requireTextConfirmation && inputText !== confirmationText) return;
    onConfirm();
    onClose();
    setInputText('');
  };

  const handleClose = () => {
    onClose();
    setInputText('');
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className="w-[calc(100%-1.5rem)] max-w-md overflow-hidden rounded-[1.5rem] border-slate-200/90 bg-white p-0 text-slate-950 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#101116] dark:text-white dark:shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] sm:rounded-[1.75rem]">
        <div className={`h-1 w-full ${isDestructive ? 'bg-rose-500' : 'bg-violet-500'}`} aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <AlertDialogHeader className="text-left">
            <div className="flex items-start gap-3.5">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDestructive ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'}`}>
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <AlertDialogTitle className="text-lg font-bold tracking-tight text-slate-950 dark:text-white sm:text-xl">
                  {title}
                </AlertDialogTitle>
                <AlertDialogDescription className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {description}
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          {requireTextConfirmation && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/[0.04]">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300" htmlFor="confirmation-text">
                Type <span className="font-mono text-slate-950 dark:text-white">{confirmationText}</span> to confirm
              </label>
              <Input
                id="confirmation-text"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder={confirmationText}
                className="mt-2 h-11 rounded-xl border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04]"
                autoComplete="off"
              />
            </div>
          )}

          <AlertDialogFooter className="mt-6 grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end sm:space-x-2">
            <AlertDialogCancel onClick={handleClose} className="mt-0 h-11 w-full rounded-xl border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08] sm:w-auto">
              {cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={requireTextConfirmation && inputText !== confirmationText}
              className={`h-11 w-full rounded-xl px-4 text-sm font-bold text-white shadow-sm sm:w-auto ${isDestructive ? 'bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600' : 'bg-slate-950 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200'} ${requireTextConfirmation && inputText !== confirmationText ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useConfirmationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
    requireTextConfirmation?: boolean;
    confirmationText?: string;
  } | null>(null);

  const showConfirmation = ({
    title,
    description,
    onConfirm,
    confirmText,
    cancelText,
    variant,
    requireTextConfirmation,
    confirmationText,
  }: {
    title: string;
    description: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
    requireTextConfirmation?: boolean;
    confirmationText?: string;
  }) => {
    setConfig({ title, description, onConfirm, confirmText, cancelText, variant, requireTextConfirmation, confirmationText });
    setIsOpen(true);
  };

  const closeConfirmation = () => {
    setIsOpen(false);
    setConfig(null);
  };

  const ConfirmationDialogComponent = config ? (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={closeConfirmation}
      onConfirm={config.onConfirm}
      title={config.title}
      description={config.description}
      confirmText={config.confirmText}
      cancelText={config.cancelText}
      variant={config.variant}
      requireTextConfirmation={config.requireTextConfirmation}
      confirmationText={config.confirmationText}
    />
  ) : null;

  return {
    showConfirmation,
    ConfirmationDialogComponent,
  };
}
