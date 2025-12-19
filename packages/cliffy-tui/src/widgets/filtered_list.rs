use ratatui::widgets::ListState;

/// A list that supports filtering while preserving selection
pub struct FilteredList<T> {
    pub items: Vec<T>,
    pub filtered_indices: Vec<usize>,
    pub list_state: ListState,
    pub filter: String,
}

impl<T> FilteredList<T> {
    pub fn new(items: Vec<T>) -> Self {
        let filtered_indices: Vec<usize> = (0..items.len()).collect();
        let mut list_state = ListState::default();
        if !filtered_indices.is_empty() {
            list_state.select(Some(0));
        }
        Self {
            items,
            filtered_indices,
            list_state,
            filter: String::new(),
        }
    }

    pub fn apply_filter<F>(&mut self, predicate: F)
    where
        F: Fn(&T) -> bool,
    {
        self.filtered_indices = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| predicate(item))
            .map(|(i, _)| i)
            .collect();

        // Reset selection if current is out of bounds
        if let Some(selected) = self.list_state.selected() {
            if selected >= self.filtered_indices.len() {
                self.list_state.select(if self.filtered_indices.is_empty() {
                    None
                } else {
                    Some(0)
                });
            }
        } else if !self.filtered_indices.is_empty() {
            self.list_state.select(Some(0));
        }
    }

    pub fn clear_filter(&mut self) {
        self.filter.clear();
        self.filtered_indices = (0..self.items.len()).collect();
        if !self.filtered_indices.is_empty() && self.list_state.selected().is_none() {
            self.list_state.select(Some(0));
        }
    }

    pub fn next(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = match self.list_state.selected() {
            Some(i) => {
                if i >= self.filtered_indices.len() - 1 {
                    0
                } else {
                    i + 1
                }
            }
            None => 0,
        };
        self.list_state.select(Some(i));
    }

    pub fn previous(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = match self.list_state.selected() {
            Some(i) => {
                if i == 0 {
                    self.filtered_indices.len() - 1
                } else {
                    i - 1
                }
            }
            None => 0,
        };
        self.list_state.select(Some(i));
    }

    pub fn selected(&self) -> Option<&T> {
        self.list_state
            .selected()
            .and_then(|i| self.filtered_indices.get(i))
            .and_then(|&idx| self.items.get(idx))
    }

    pub fn selected_index(&self) -> Option<usize> {
        self.list_state
            .selected()
            .and_then(|i| self.filtered_indices.get(i).copied())
    }

    pub fn filtered_items(&self) -> impl Iterator<Item = &T> {
        self.filtered_indices.iter().map(|&i| &self.items[i])
    }

    pub fn len(&self) -> usize {
        self.filtered_indices.len()
    }

    pub fn is_empty(&self) -> bool {
        self.filtered_indices.is_empty()
    }

    pub fn total_len(&self) -> usize {
        self.items.len()
    }
}
