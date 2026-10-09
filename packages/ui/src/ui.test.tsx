import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FileField,
  Input,
  KeyValue,
  LoadingState,
  Modal,
  OtpInput,
  Select,
  Stepper,
  StatusChip,
  Table,
  Tabs,
  Textarea,
  Timeline,
} from './index';

describe('foundation components', () => {
  it('Button handles clicks, disabled and loading states', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('Field links label, input and error', () => {
    render(
      <Field label="Email" htmlFor="e" error="Required">
        <Input id="e" invalid />
      </Field>,
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('Select and Checkbox render accessibly', () => {
    render(
      <>
        <Select aria-label="City">
          <option>Riyadh</option>
        </Select>
        <Checkbox label="I agree" />
      </>,
    );
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('I agree')).toBeInTheDocument();
  });

  it('OtpInput collects digits, ignores letters, supports paste and stays LTR', async () => {
    const onComplete = vi.fn();
    render(
      <div dir="rtl">
        <OtpInput onComplete={onComplete} aria-label="Code" />
      </div>,
    );
    // one accessible input, six drawn boxes (hidden from assistive tech), always LTR
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAccessibleName('Code');
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(boxes[0]!.closest('.dd-otp')).toHaveAttribute('dir', 'ltr');
    expect(document.querySelectorAll('.dd-otp__box')).toHaveLength(6);
    await userEvent.type(boxes[0]!, 'a1');
    expect(boxes[0]).toHaveValue('1');
    await userEvent.type(boxes[0]!, '{Backspace}');
    expect(boxes[0]).toHaveValue('');
    fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => '12 34-56' } });
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('StatusChip and Alert expose tone classes and roles', () => {
    render(
      <>
        <StatusChip tone="success">Active</StatusChip>
        <Alert tone="danger" title="Failed">
          Try later
        </Alert>
      </>,
    );
    expect(screen.getByText('Active')).toHaveClass('dd-chip--success');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('Modal and Drawer close on Escape and expose dialog semantics', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Drawer open onClose={onClose} title="Details">
        Body
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument();
    rerender(
      <Drawer open={false} onClose={onClose} title="Details">
        Body
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Modal keeps focus in the field being typed in when the parent re-renders on every keystroke', async () => {
    function Host() {
      const [value, setValue] = useState('');
      return (
        <Modal open onClose={() => setValue('')} title="Edit">
          <Textarea aria-label="Message" value={value} onChange={(e) => setValue(e.target.value)} />
        </Modal>
      );
    }
    render(<Host />);
    await userEvent.type(screen.getByLabelText('Message'), 'Hello world');
    expect(screen.getByLabelText('Message')).toHaveValue('Hello world');
    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  it('Stepper exposes the current step and reports selection', async () => {
    const onSelect = vi.fn();
    render(
      <Stepper
        label="Steps"
        onSelect={onSelect}
        steps={[
          { id: 'a', label: 'First', state: 'done' },
          { id: 'b', label: 'Second', state: 'current' },
          { id: 'c', label: 'Third', state: 'attention', hint: 'Fix this' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Fix this')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Third/ }));
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('Timeline, KeyValue and FileField render accessibly', async () => {
    const onFile = vi.fn();
    render(
      <>
        <Timeline
          label="History"
          items={[{ id: '1', title: 'Approved', meta: 'today', tone: 'success' }]}
        />
        <KeyValue items={[{ label: 'Name', value: 'Olive' }]} />
        <FileField id="f" label="Choose file" accept="application/pdf" onFile={onFile} />
      </>,
    );
    expect(screen.getByRole('list', { name: 'History' })).toHaveTextContent('Approved');
    expect(screen.getByText('Name')).toBeInTheDocument();
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Choose file'), file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('Tabs select by click and arrow keys', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Sections"
        value="a"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
    screen.getByRole('tab', { name: 'A' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('Table renders rows, numeric columns and the empty state', () => {
    const { rerender } = render(
      <Table
        columns={[
          { key: 'name', header: 'Merchant' },
          { key: 'n', header: 'Branches', numeric: true },
        ]}
        rows={[{ id: '1', name: 'Nobu', n: 2 }]}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="Nothing" />}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Branches' })).toHaveClass('dd-num');
    expect(screen.getByText('Nobu')).toBeInTheDocument();
    rerender(
      <Table columns={[]} rows={[]} rowKey={() => 'x'} empty={<EmptyState title="Nothing" />} />,
    );
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('State components expose status roles and retry', async () => {
    const onRetry = vi.fn();
    render(
      <>
        <LoadingState />
        <ErrorState title="Oops" onRetry={onRetry} retryLabel="Retry" />
        <Card>content</Card>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

describe('RTL safety of the design system stylesheet', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses logical properties only (no physical left/right layout properties)', () => {
    const physical = [
      /margin-left/,
      /margin-right/,
      /padding-left/,
      /padding-right/,
      /border-left/,
      /border-right/,
      /text-align:\s*(left|right)/,
      /float:\s*(left|right)/,
      /(^|[\s;{])left:/,
      /(^|[\s;{])right:/,
    ];
    for (const re of physical) expect(css, String(re)).not.toMatch(re);
  });

  it('declares the approved brand tokens', () => {
    expect(css).toContain('--dd-navy: #0f0c42');
    expect(css).toContain('--dd-purple: #5b1afc');
    expect(css).toContain("'Plus Jakarta Sans'");
    expect(css).toContain("'IBM Plex Sans Arabic'");
  });
});
