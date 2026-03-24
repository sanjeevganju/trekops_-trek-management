export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const getDeadlineDate = (startDate: string, offset: number) => {
  const date = new Date(startDate);
  date.setDate(date.getDate() - offset);
  return date;
};

export const formatDeadline = (startDate: string, offset: number) => {
  const date = getDeadlineDate(startDate, offset);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export const isOverdue = (startDate: string, offset: number) => {
  const deadline = getDeadlineDate(startDate, offset);
  return deadline < new Date();
};
